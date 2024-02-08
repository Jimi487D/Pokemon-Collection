"use client"
import { withAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { signOut } from 'aws-amplify/auth';
import { Amplify } from "aws-amplify";
import { get, put } from 'aws-amplify/api';
import awsconfig from "@/src/aws-exports";
import React, { useEffect, useState } from 'react';
import './App.css'; // Import CSS file for styling

Amplify.configure(awsconfig);
const apiName = 'pokemoncollection';
const path = '/pokemon';

function App() {
  const [pokemonData, setPokemonData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataFetched, setDataFetched] = useState(false);

  // Function to handle signing out
  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      console.log('error signing out: ', error);
    }
  }

  // Function to fetch pokemon data from the endpoint
  async function fetchPokemonData() {
    console.log("Fetching Pokemon data...");
    try {
      const response = await get({ apiName, path });
      const { body } = await response.response;
      let data: any = {};
      data = await body.json();
      console.log("Pokemon data:", data);
      const sortedData = data?.userPokemonData.sort((a: any, b:any) => parseInt(a.pokemonId?.S) - parseInt(b.pokemonId?.S));
      setPokemonData(sortedData);
      setIsLoading(false);
      setError(null);
      setDataFetched(true);
      console.log("Finished retrieving pokemon table");
    } catch (error) {
      console.error('Error retrieving pokemon table:', error);
      setError('Failed to fetch Pokemon data');
      setIsLoading(false);
      setDataFetched(true);
    }
  }

  async function togglePokemonObtained(pokemonId:string, isObtained:boolean) {
    try {
      // Define the payload for updating the item
      const payload = {
        pokemonId: pokemonId,
        isObtained: !isObtained // Toggle the isObtained value
      };

      // Call the put method to update the item
      const response = await put({
        apiName: apiName, // Your API name
        path: path, // Path to your endpoint
        options: {
          body: payload
        }
      });
      console.log('Response from toggle:', (await response.response));
      // Refresh data after toggling
      fetchPokemonData();
    } catch (error) {
      console.error('Error toggling pokemon obtained status:', error);
    }
  }
  
  // Fetch pokemon data on component mount
  useEffect(() => {
    if (!dataFetched) {
      fetchPokemonData();
    }
  }, [dataFetched]);

  return (
    <>
      <h1>Welcome, Pokémon Trainer! 👋</h1>
      <div className="sign-out-button-container">
      <button className="sign-out-button" onClick={handleSignOut}>Sign Out</button>
    </div>
      {isLoading ? (
        <p>Loading...</p>
      ) : error ? (
        <p>{error}</p>
      ) : (
        <>
          {pokemonData.length > 0 ? (
            <div className="pokemon-container">
              <div className="pokemon-grid">
                {pokemonData.map((pokemon:any, index) => (
                  <div key={index} className={`pokemon-card ${pokemon.isObtained?.BOOL ? '' : 'black-and-white'}`} onClick={() => togglePokemonObtained(pokemon.pokemonId?.S, pokemon.isObtained?.BOOL)}>
                    <img
                      src={pokemon.imageURL?.S}
                      alt={pokemon.pokemonName?.S}
                    />
                    <p>{pokemon.pokemonName?.S}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p>No Pokémon data available.</p>
          )}

        </>
      )}
    </>
  );


}
export default withAuthenticator(App);
