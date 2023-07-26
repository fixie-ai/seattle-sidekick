/** @jsxImportSource ai-jsx */
/* eslint-disable react/jsx-key */
import { toTextStream } from 'ai-jsx/stream'
import {
  ChatCompletion,
  ConversationHistory,
  SystemMessage,
  UserMessage
} from 'ai-jsx/core/completion'
import { Prompt } from 'ai-jsx/batteries/prompts'
import { Tool, UseTools } from 'ai-jsx/batteries/use-tools';
import { OpenAI } from 'ai-jsx/lib/openai'
import { StreamingTextResponse } from 'ai'
import { PropsOfComponent } from 'ai-jsx'
import got from 'got'
import url from 'node:url';
import querystring from 'node:querystring';
import _ from 'lodash'
import * as AI from 'ai-jsx'
import {PinoLogger} from 'ai-jsx/core/log'
import { pino } from 'pino';

const pinoStdoutLogger = pino({
  name: 'ai-jsx',
  level: process.env.loglevel ?? 'trace',
});

type Messages = PropsOfComponent<typeof ConversationHistory>['messages'];

function App({ messages }: { messages: Messages }, {logger, render}: AI.ComponentContext) {

  const defaultSeattleCoordinates = '47.6062,-122.3321';
  const tools: Record<string, Tool> = {
    searchForPlaces: {
      description: 'Search for places (restaurants, businesses, etc) in a given area',
      parameters: {
        query: {
          description: 'The search query, e.g. "brunch" or "parks" or "tattoo parlor"',
          type: 'string',
          required: true
        },
        location: {
          description: `The location to search around, given as lat/long coords. If omitted, it defaults to downtown Seattle (${defaultSeattleCoordinates})`,
          type: 'string',
          required: false
        },
        searchRadius: {
          description: 'The radius to search around, in meters. If omitted, it defaults to 1000 meters',
          type: 'number',
          required: false
        }
      },
      func: async ({ query, location = defaultSeattleCoordinates, searchRadius = 1000 }) => {
        const googleMapsApiUrl = new url.URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
        const params = {
            query,
            location,
            radius: searchRadius,
            key: process.env.GOOGLE_MAPS_API_KEY
        };
        
        googleMapsApiUrl.search = querystring.stringify(params);
        // @ts-expect-error got types are wrong
        const responseBody = await got(googleMapsApiUrl.toString()).json();
        logger.info({responseBody, query, location, searchRadius}, 'Got response from google maps place search API')
        return JSON.stringify(responseBody);
      }
    },
    getLatLongOfLocation: {
      description: 'Get the lat/long coordinates of a location.',
      parameters: {
        location: {
          description: 'The location to get the lat/long coordinates of, e.g. "Seattle, WA" or "123 My Street, Bellevue WA"',
          type: 'string',
          required: true
        }
      },
      func: async ({ location }) => {
        const googleMapsApiUrl = new url.URL('https://maps.googleapis.com/maps/api/geocode/json');
        const params = {
            address: location,
            key: process.env.GOOGLE_MAPS_API_KEY
        };
        
        googleMapsApiUrl.search = querystring.stringify(params);
        // @ts-expect-error got types are wrong
        const responseBody = await got(googleMapsApiUrl.toString()).json();
        logger.info({responseBody, location}, 'Got response from google maps geocode API')
        return JSON.stringify(responseBody);
      }
    },
    getDirections: {
      description: 'Get directions between two locations via a variety of ways (walking, driving, public transit, etc.)',
      parameters: {
        origin: {
          description: 'The starting location, e.g. "South Lake Union, Seattle, WA" or "123 My Street, Bellevue WA", or a Google Maps place ID, or lat/long coords. If you give a location name, you need to include the city and state. Do not just give the name of a neighborhood.',
          type: 'string',
          required: true
        },
        destination: {
          description: 'The ending location, e.g. "Fremont, Seattle, WA" or "123 My Street, Bellevue WA", or a Google Maps place ID, or lat/long coords. If you give a location name, you need to include the city and state. Do not just give the name of a neighborhood.',
          type: 'string',
          required: true
        }
      },
      func: async ({ origin, destination }) => {
        const googleMapsApiUrl = new url.URL('https://maps.googleapis.com/maps/api/directions/json');
        const params = {
            destination: ensurePlaceIsDescriptiveEnough(destination),
            origin: ensurePlaceIsDescriptiveEnough(origin),
            key: process.env.GOOGLE_MAPS_API_KEY
        };

        /**
         * If you pass `ballard` to the Google Maps API, it fails. You need to pass `ballard, seattle` or `ballard, wa`.
         * We tell the AI this, but it doesn't always comply.
         */
        function ensurePlaceIsDescriptiveEnough(place: string) {
          /**
           * I think this will work in most cases. If the AI has already appended `, WA` to the string, Google Maps 
           * tolerates having multiple `, WA` suffixes.
           * 
           * This will fail if the user asks for directions out of state.
           */
          return `${place}, WA`;

          /**
           * If the above simple approach didn't work, we could so something like:
           */

          // return render(<OpenAI chatModel='gpt-3.5-turbo'>
          //   <ChatCompletion>
          //     <SystemMessage>The user will give you a place name, like {'"'}Capitol Hill{'"'}. If the place name is too specific, fix it by adding the city and state name to the end. For instance, {'"'}Capitol Hill{'"'} would become {'"'}Capitol Hill, Seattle, WA{'"'}.</SystemMessage>
          //     <UserMessage>{place}</UserMessage>
          //   </ChatCompletion>
          // </OpenAI>)
        }
        
        googleMapsApiUrl.search = querystring.stringify(params);
        try {
          // @ts-expect-error got types are wrong
          const responseBody = await got(googleMapsApiUrl.toString()).json();
          logger.info({responseBody, ..._.omit(params, 'key')}, 'Got response from google maps directions API') 
          return JSON.stringify(responseBody);
        } catch (e) {
          logger.error({e, ..._.omit(params, 'key')}, 'Got error calling google maps directions API')
          throw e;
        }
      }
    }
  }

  return (
    <OpenAI chatModel='gpt-4'>
      <UseTools tools={tools} showSteps fallback=''>
        <SystemMessage>
          <Prompt hhh persona="expert travel planner" />
          You help users with plan activities in Seattle. You can look for locations and find directions. If a user asks for anything not related to that, tell them you cannot help.

          If the user asks for location information and directions, you will be given live API calls in subsequent systems messages. You should respond to the user{"'"}s request using the results of those API calls. If those API calls errored out, tell the user there was an error making the request. Do not tell them you will try again.
          
          {/* This is not respected. */}
          Do not attempt to answer using your latent knowledge.
          
          Respond concisely, using markdown formatting to make your response more readable and structured.
        </SystemMessage>
        <ConversationHistory messages={messages} />
      </UseTools>
    </OpenAI>
  )
}

/**
 * I want UseTools to bomb out harder – just give me an error boundary. The fallback actually makes it harder.
 * NLR needs the full conversational history.
 * 
 * We should probably store all previous API call results and make them available to future calls.
 * 
 * Questions I've used with this:
 *    how can I get from ballard to belltown?
 */

export async function POST(req: Request) {
  const { messages } = await req.json()

  return new StreamingTextResponse(toTextStream(<App messages={messages} />, new PinoLogger(pinoStdoutLogger)))
}
