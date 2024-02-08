const { S3Client, ListObjectsCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient, QueryCommand, BatchWriteItemCommand, GetItemCommand, BatchGetItemCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityClient, GetIdCommand } = require('@aws-sdk/client-cognito-identity');
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware')
const bodyParser = require('body-parser')
const express = require('express')

const region = 'us-west-2';
const pokemonBucket = "pokemon-base-cards";

const ddbClient = new DynamoDBClient({ region: process.env.TABLE_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({ region: region });


let tableName = "pokemoncollection";
if (process.env.ENV && process.env.ENV !== "NONE") {
  tableName = tableName + '-' + process.env.ENV;
}

const userIdPresent = false; // TODO: update in case is required to use that definition
const partitionKeyName = "userID";
const partitionKeyType = "S";
const sortKeyName = "pokemonId";
const sortKeyType = "S";
const hasSortKey = sortKeyName !== "";
const path = "/pokemon";

// declare a new express app
const app = express()
app.use(bodyParser.json())
app.use(awsServerlessExpressMiddleware.eventContext())

// Enable CORS for all methods
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "*")
  next()
});

// Retrieve the Cognito Identity ID from the user
function getUserCognitoId(req) {
  return req.apiGateway.event.requestContext.identity.cognitoIdentityId;
}

// Scan the S3 bucket to get the list of files
async function scanS3Bucket() {
  const s3Params = { Bucket: pokemonBucket };
  const { Contents } = await s3Client.send(new ListObjectsCommand(s3Params));
  return Contents || [];
}

// Parse the S3 bucket data into the DynamoDB table
async function parseS3DataIntoDynamoDB(cognitoUserId, contents) {
  let successItems = [];
  let errorItems = [];

  for (let i = 0; i < contents.length; i += 25) {
    const batchItems = contents.slice(i, i + 25);
    const batchPutParams = {
      RequestItems: {
        [tableName]: batchItems.map(content => {
          try {
            const fileName = content.Key;
            const [pokemonName, index, set] = fileName.split('-');
            const pokemonId = parseInt(fileName.split('-').pop().split('.')[0]);
            const formattedPokemonName = pokemonName.replace(/-/g, ' ');
            const imageURL = `https://${pokemonBucket}.s3.amazonaws.com/${fileName}`;
            console.log("Image url is: ", imageURL);

            return {
              PutRequest: {
                Item: {
                  userID: { S: cognitoUserId },
                  pokemonId: { S: pokemonId.toString() },
                  pokemonName: { S: formattedPokemonName },
                  set: { S: set },
                  isObtained: { BOOL: false },
                  imageURL: { S: imageURL }
                }
              }
            };
          } catch (error) {
            console.error("Error processing file: ", content.Key, error);
            errorItems.push(content.Key);
            throw error;
          }
        }).filter(item => item !== null)
      }
    };

    try {
      const result = await ddbDocClient.send(new BatchWriteItemCommand(batchPutParams));
      const unprocessedItems = result.UnprocessedItems && result.UnprocessedItems[tableName];

      if (unprocessedItems && unprocessedItems.length > 0) {
        errorItems = errorItems.concat(batchItems.map(item => item.Key));
      } else {
        successItems = successItems.concat(batchItems.map(item => item.Key));
      }
    } catch (error) {
      console.error('Error inserting Pokemon data:', error);
      errorItems = errorItems.concat(batchItems.map(item => item.Key));
    }
  }

  return { successItems, errorItems };
}

async function retrievePokemonTable(cognitoUserId) {
  console.log("Entered retrieve pokemon table");
  try {
    const items = [];
    let exclusiveStartKey = undefined;

    do {
      const params = {
        TableName: tableName,
        KeyConditionExpression: "#userID = :userID",
        ExpressionAttributeNames: {
          "#userID": partitionKeyName,
        },
        ExpressionAttributeValues: {
          ":userID": { S: cognitoUserId },
        },
        ExclusiveStartKey: exclusiveStartKey,
      };

    console.log("About to call the db table")
    const command = new QueryCommand(params);
      const response = await ddbClient.send(command);
      console.log("About to push into array");
      items.push(...response.Items);
      exclusiveStartKey = response.LastEvaluatedKey;

    } while (exclusiveStartKey);

    console.log("About to return items");
    return items;
  } catch (error) {
    console.error('Error retrieving Pokemon data from DynamoDB:', error);
    throw error;
  }
}

// Route handler for /pokemon
app.get('/pokemon', async function (req, res) {
  try {
    const cognitoUserId = getUserCognitoId(req);
    
    // Check if the DynamoDB table exists for the user
    const dynamoDBData = await ddbDocClient.send(new GetItemCommand({
      TableName: tableName,
      Key: {
        [partitionKeyName]: { S: cognitoUserId },
        [sortKeyName]: { S: "1" }
      }
    }));

    let userPokemonData;
    
    if (!dynamoDBData.Item) {
      // If the table doesn't exist, parse the S3 data into DynamoDB
      const contents = await scanS3Bucket();
      if (!contents || contents.length === 0) {
        return res.json({ success: true, message: "No pokemon cards found in the bucket" });
      }
      const { successItems, errorItems } = await parseS3DataIntoDynamoDB(cognitoUserId, contents);
      userPokemonData = await retrievePokemonTable(cognitoUserId);
    } else {
      userPokemonData = await retrievePokemonTable(cognitoUserId);
    }
      return res.json({
        success: true,
        message: 'Pokemon data inserted successfully',
        userPokemonData:userPokemonData
      });

  } catch (error) {
    console.error('Error retrieving or inserting Pokemon data:', error);
    res.status(500).json({ error: 'Failed to fetch or insert Pokemon data' });
  }
});

app.listen(3000, function () {
  console.log("App started")
});

module.exports = app;