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

class ConsoleLogger extends LogImplementation {
  log(level: LogLevel, element: AI.Element<any>, renderId: string, obj: unknown | string, msg?: string) {
    const args = [] as unknown[];
    args.push(`<${element.tag.name}>`, renderId);
    if (msg) {
      args.push(msg);
    }
    if (obj) {
      args.push(obj);
    }
    console[level === 'fatal' ? 'error' : level](...args);
  }
}

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
          You help users plan activities to Seattle. If a user asks for anything not related to that, tell them you can{"'"}t help.
          Respond concisely, using markdown formatting to make your response more readable and structured.
        </SystemMessage>
        <NaturalLanguageRouter query={latestMessage.content!}>
          <Route when="to respond to the user's request, it would be helpful to get directions">
            <SystemMessage>
              The directions the user asked for: <UseTools tools={tools} fallback='' query={latestMessage.content!} />
            </SystemMessage>
          </Route>
          <Route when="to respond to the user's request, it would be helpful search for locations">
            <SystemMessage>
              The directions the user asked for: <UseTools tools={tools} fallback='' query={latestMessage.content!} />
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

  return new StreamingTextResponse(toTextStream(<App messages={messages} />, new ConsoleLogger()))
}
