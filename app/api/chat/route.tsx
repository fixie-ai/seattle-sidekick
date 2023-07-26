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
import { Jsonifiable } from 'type-fest'
import {
  Corpus,
  DefaultFormatter,
  DocsQAProps,
  ScoredChunk
} from 'ai-jsx/batteries/docs'

const pinoStdoutLogger = pino({
  name: 'ai-jsx',
  level: process.env.loglevel ?? 'trace',
});

type Messages = PropsOfComponent<typeof ConversationHistory>['messages'];

const seattleCorpusId = '1138';

function App({ messages }: { messages: Messages }, {logger, render}: AI.ComponentContext) {

  const corpus = new FixieCorpus(seattleCorpusId)

  const defaultSeattleCoordinates = '47.6062,-122.3321';
  const tools: Record<string, Tool> = {
    lookUpSeattleInfo: {
      description: 'Look up information about Seattle from a corpus that includes recent news stories, public events, travel blogs and guides, neighborhood blogs, and more.',
      parameters: {
        query: {
          description: 'The search query. It will be embedded and used in a vector search against the corpus.',
          type: 'string',
          required: true
        }
      },
      func: async ({ query }) => {
        const results = await corpus.search(query, { limit: 3 })
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

  return (
    <OpenAI chatModel='gpt-4'>
      <UseTools tools={tools} showSteps fallback=''>
        <SystemMessage>
          <Prompt hhh persona="expert travel planner" />
          You help users with plan activities in Seattle. You can look for locations and find directions. If a user asks for anything not related to that, tell them you cannot help.

          You have access to functions to look up live data about Seattle, including tourist info, attractions, and directions. If the user asks a question that would benefit from that info, call those functions, instead of answering from your latent knowledge.

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

  return new StreamingTextResponse(toTextStream(<App messages={messages} />, new PinoLogger(pinoStdoutLogger)))
}

class FixieCorpus<ChunkMetadata extends Jsonifiable = Jsonifiable>
  implements Corpus<ChunkMetadata>
{
  private static readonly DEFAULT_FIXIE_API_URL = 'https://app.fixie.ai/api'

  private readonly fixieApiUrl: string

  constructor(
    private readonly corpusId: string,
    private readonly fixieApiKey?: string
  ) {
    if (!fixieApiKey) {
      this.fixieApiKey = process.env['FIXIE_API_KEY']
      if (!this.fixieApiKey) {
        throw new Error(
          'You must provide a Fixie API key to access Fixie corpora. Find yours at https://app.fixie.ai/profile.'
        )
      }
    }
    this.fixieApiUrl =
      process.env['FIXIE_API_URL'] ?? FixieCorpus.DEFAULT_FIXIE_API_URL
  }

  async search(
    query: string,
    params?: { limit?: number; metadata_filter?: any }
  ): Promise<ScoredChunk<ChunkMetadata>[]> {
    const response = await fetch(
      `${this.fixieApiUrl}/corpora/${this.corpusId}:query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.fixieApiKey}`
        },
        body: JSON.stringify({
          query_string: query,
          chunk_limit: params?.limit,
          metadata_filter: params?.metadata_filter
        })
      }
    )
    if (response.status !== 200) {
      throw new Error(
        `Fixie API returned status ${response.status}: ${await response.text()}`
      )
    }
    const apiResults = await response.json()
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