/** @jsxImportSource ai-jsx */
/* eslint-disable react/jsx-key */
import { toTextStream } from 'ai-jsx/stream'
import {
  ConversationHistory,
  SystemMessage,
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
import { pino } from 'pino';
import { Jsonifiable } from 'type-fest'
import {
  Corpus,
  ScoredChunk
} from 'ai-jsx/batteries/docs'

type Messages = PropsOfComponent<typeof ConversationHistory>['messages'];

const seattleCorpusId = '1138';

const coporaPromise = fixieFetch('/graphql', JSON.stringify({
  query: ` query {
    agentById(agentId: "ben2/SeattleSidekick") {
      currentRevision{
        configuration {
          ... on CodeShotAgent {
            corpora {
              ... on UrlCorpusInfo {
                urls
              }
            }
          }
        }
      }
    }
  }
`})
)

async function App({ messages }: { messages: Messages }, {logger, render}: AI.ComponentContext) {

  const corpora = await coporaPromise;
  logger.warn({corpora}, 'API response')
  const corpus = new FixieCorpus(seattleCorpusId)

  const defaultSeattleCoordinates = '47.6062,-122.3321';
  const tools: Record<string, Tool> = {
    lookUpSeattleInfo: {
      // Call the Fixie API and just give the model the full set of URLs.
      description: 'Look up information about Seattle from a corpus that includes recent news stories, public events, travel blogs and guides, neighborhood blogs, and more.',
      parameters: {
        query: {
          description: 'The search query. It will be embedded and used in a vector search against the corpus.',
          type: 'string',
          required: true
        }
      },
      func: async ({ query }) => {
        const results = await corpus.search(query, { limit: 2 })
        logger.info({results, query}, 'Got results from Fixie corpus search');
        return render(<>
          {results.map(chunk => <ChunkFormatter doc={chunk} />)}
        </>)
      }
    },
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

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDate = daysOfWeek[new Date().getDay()];

  return (
    <OpenAI chatModel='gpt-4'>
      <UseTools tools={tools} showSteps fallback=''>
        <SystemMessage>
          <Prompt hhh persona="expert travel planner" />
          You help users plan activities and learn more about Seattle. If a user asks for anything not related to that, tell them you cannot help.

          The current date and time is: {new Date().toLocaleString()}. The current day of the week is: {currentDate}.

          If the user asks an open-ended question, like {'"'}what is the weather{'"'}, assume it is intended in the context of Seattle. If the user does not specify a date or time, assume it is intended either now or in the near future. 

          You have access to functions to look up live data about Seattle, including tourist info, attractions, and directions. If the user asks a question that would benefit from that info, call those functions, instead of answering from your latent knowledge. When you query these functions, make sure to include the current date or time if it is relevant. (For instance, if the user asks {'"'}are there sporting events today{'"'}, your search to lookUpSeattleInfo should be something like {'"'}sporting events in Seattle on {new Date().toLocaleDateString()} {'"'}.)
          
          Also, when you look at the function definition, you may see that you need more information from the user before you can use those functions. In that case, ask the user for the missing information.

          If the API calls errored out, tell the user there was an error making the request. Do not tell them you will try again.

          {/* This is not respected. */}
          Do not attempt to answer using your latent knowledge.
          
          Respond concisely, using markdown formatting to make your response more readable and structured.

          You may suggest follow-up ideas to the user, if they fall within the scope of what you are able to do.

          
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

  return new StreamingTextResponse(toTextStream(<App messages={messages} />))
}

async function fixieFetch(pathname: string, body: string) {
  const fixieApiUrl = process.env['FIXIE_API_URL'] ?? 'https://app.fixie.ai/'

  const apiKey = process.env['FIXIE_API_KEY']
  if (!apiKey) {
    throw new Error(
      'You must provide a Fixie API key to access Fixie corpora. Find yours at https://app.fixie.ai/profile.'
    )
  }
  const response = await fetch(
    fixieApiUrl + pathname,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body 
    }
  )
  if (response.status !== 200) {
    throw new Error(
      `Fixie API returned status ${response.status}: ${await response.text()}`
    )
  }
  return await response.json()
}

class FixieCorpus<ChunkMetadata extends Jsonifiable = Jsonifiable>
  implements Corpus<ChunkMetadata>
{
  constructor(
    private readonly corpusId: string,
  ) {
  }

  async search(
    query: string,
    params?: { limit?: number; metadata_filter?: any }
  ): Promise<ScoredChunk<ChunkMetadata>[]> {
    const apiResults = await fixieFetch(
      `/api/corpora/${this.corpusId}:query`,
      JSON.stringify({
        query_string: query,
        chunk_limit: params?.limit,
        metadata_filter: params?.metadata_filter
      })
    );
    
    return apiResults.chunks.map((result: any) => ({
      chunk: {
        content: result.content,
        metadata: result.metadata,
        documentName: result.document_name
      },
      score: result.score
    }))
  }
}

function ChunkFormatter({ doc }: { doc: ScoredChunk<any> }) {
  return <>
  {'\n\n'}Chunk from source: {doc.chunk.metadata?.source}
    {`\n\`\`\`chunk \n`}
    {doc.chunk.content}
    {'\n```\n'}
  </>
}