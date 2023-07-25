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

function App({ messages }: { messages: PropsOfComponent<typeof ConversationHistory>['messages'] }, {logger}: AI.ComponentContext) {

  const tools: Record<string, Tool> = {
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
        </SystemMessage>
        <NaturalLanguageRouter query={latestMessage.content!}>
          <Route when="to respond to the user's request, it would be helpful to get directions">
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

  return new StreamingTextResponse(toTextStream(<App messages={messages} />))
}
