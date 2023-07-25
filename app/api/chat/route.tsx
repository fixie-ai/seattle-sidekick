/** @jsxImportSource ai-jsx */
import { toTextStream } from 'ai-jsx/stream'
import {
  ChatCompletion,
  ConversationHistory,
  SystemMessage
} from 'ai-jsx/core/completion'
import { Prompt } from 'ai-jsx/batteries/prompts'
import { UseTools, Tool } from 'ai-jsx/batteries/use-tools';
import { NaturalLanguageRouter, Route } from 'ai-jsx/batteries/natural-language-router'
import { OpenAI } from 'ai-jsx/lib/openai'
import { StreamingTextResponse } from 'ai'
import { PropsOfComponent } from 'ai-jsx'
import got from 'got'
import url from 'node:url';
import querystring from 'node:querystring';
import _ from 'lodash'
import * as AI from 'ai-jsx'
import {LogImplementation, LogLevel, PinoLogger} from 'ai-jsx/core/log'
import { pino } from 'pino';


const pinoStdoutLogger = pino({
  name: 'ai-jsx',
  level: process.env.loglevel ?? 'trace',
});

function App({ messages }: { messages: PropsOfComponent<typeof ConversationHistory>['messages'] }, {logger}: AI.ComponentContext) {

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
        const responseBody = (await got(googleMapsApiUrl.toString(), {json: true})).body;
        logger.info({responseBody, query, location, searchRadius}, 'Got response from google maps API')
        return responseBody;
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
        const responseBody = (await got(googleMapsApiUrl.toString(), {json: true})).body;
        logger.info({responseBody, location}, 'Got response from google maps API')
        return responseBody;
      }
    },
    getDirections: {
      description: 'Get directions between two locations via a variety of ways (walking, driving, public transit, etc.)',
      parameters: {
        origin: {
          description: 'The starting location, e.g. "Seattle, WA" or "123 My Street, Bellevue WA", or a Google Maps place ID, or lat/long coords',
          type: 'string',
          required: true
        },
        destination: {
          description: 'The ending location, e.g. "Seattle, WA" or "123 My Street, Bellevue WA", or a Google Maps place ID, or lat/long coords',
          type: 'string',
          required: true
        }
      },
      func: async ({ origin, destination }) => {
        const googleMapsApiUrl = new url.URL('https://maps.googleapis.com/maps/api/directions/json');
        const params = {
            destination,
            origin,
            key: process.env.GOOGLE_MAPS_API_KEY
        };
        
        googleMapsApiUrl.search = querystring.stringify(params);
        const responseBody = (await got(googleMapsApiUrl.toString(), {json: true})).body;
        logger.info({responseBody, destination, origin}, 'Got response from google maps API')
        return responseBody;
      }
    }
  }

  const latestMessage = _.last(messages)!;

  return (
    <OpenAI chatModel='gpt-4'>
      <ChatCompletion>
        <SystemMessage>
          <Prompt hhh persona="expert travel planner" />
          You help users with plan activities in Seattle. You can look for locations and find directions. If a user asks for anything not related to that, tell them you can{"'"}t help.

          If the user asks for location information and directions, you will be given live API calls in subsequent systems messages. You should respond to the user{"'"}s request using the results of those API calls. If those API calls errored out, tell the user there was an error making the request. Do not attempt to answer using your latent knowledge.
          
          Respond concisely, using markdown formatting to make your response more readable and structured.
        </SystemMessage>
        <NaturalLanguageRouter query={latestMessage.content!}>
          <Route when="to respond to the user's request, it would be helpful to get directions">
            <SystemMessage>
              Do not use your own knowledge about directions. Instead, use the results of this live API call: <UseTools tools={tools} fallback='Tell the user there was an error making the request.' query={latestMessage.content!} />
            </SystemMessage>
          </Route>
          <Route when="to respond to the user's request, it would be helpful search for locations">
            <SystemMessage>
            Do not use your own knowledge about places. Instead, use the results of this live API call: <UseTools tools={tools} fallback='Tell the user there was an error making the request.' query={latestMessage.content!} />
            </SystemMessage>
          </Route>
          <Route unmatched><></></Route>
        </NaturalLanguageRouter>
        <ConversationHistory messages={messages} />
      </ChatCompletion>
    </OpenAI>
  )
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  return new StreamingTextResponse(toTextStream(<App messages={messages} />, new PinoLogger(pinoStdoutLogger)))
}
