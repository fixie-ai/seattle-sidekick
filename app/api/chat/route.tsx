/** @jsxImportSource ai-jsx */
import { toTextStream } from 'ai-jsx/stream'
import {
  ChatCompletion,
  ConversationHistory,
  SystemMessage
} from 'ai-jsx/core/completion'
import { Prompt } from 'ai-jsx/batteries/prompts'
import { StreamingTextResponse } from 'ai'
import { PropsOfComponent } from 'ai-jsx'

function App({ messages }: { messages: PropsOfComponent<typeof ConversationHistory>['messages'] }) {
  return (
    <ChatCompletion temperature={1}>
      <SystemMessage>
        <Prompt hhh persona="expert translator" />
        Translate any messages you receive to French. Respond only with the
        translation.
      </SystemMessage>
      <ConversationHistory messages={messages} />
    </ChatCompletion>
  )
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  return new StreamingTextResponse(toTextStream(<App messages={messages} />))
}
