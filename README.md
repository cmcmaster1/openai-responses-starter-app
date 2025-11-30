# Responses starter app

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![NextJS](https://img.shields.io/badge/Built_with-NextJS-blue)
![OpenAI API](https://img.shields.io/badge/Powered_by-OpenAI_API-orange)

This repository contains a NextJS starter app built on top of the [Responses API](https://platform.openai.com/docs/api-reference/responses).
It implements a multi-turn chat interface with synthetic streaming and first-class [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) tool support.

Features:

- Multi-turn conversation handling with persistent session history (create/select/clear)
- Synthetic streaming over SSE for assistant messages, tool calls, and tool results
- MCP server configuration and execution (HTTP or stdio transports)
- Tool trace rendering (MCP approvals, results, reasoning snippets)

This app is meant to be used as a starting point to build a conversational assistant that you can customize to your needs.

## How to use

1. **Set up the OpenAI API:**

   - If you're new to the OpenAI API, [sign up for an account](https://platform.openai.com/signup).
   - Follow the [Quickstart](https://platform.openai.com/docs/quickstart) to retrieve your API key.

2. **Set the OpenAI API key:**

   2 options:

   - Set the `OPENAI_API_KEY` environment variable [globally in your system](https://platform.openai.com/docs/libraries#create-and-export-an-api-key)
   - Set the `OPENAI_API_KEY` environment variable in the project: Create a `.env` file at the root of the project and add the following line (see `.env.example` for reference):

   ```bash
   OPENAI_API_KEY=<your_api_key>
   ```

3. **Clone the Repository:**

   ```bash
   git clone https://github.com/openai/openai-responses-starter-app.git
   ```

4. **Install dependencies:**

   Run in the project root:

   ```bash
   npm install
   ```

5. **Run the app:**

   ```bash
   npm run dev
   ```

   The app will be available at [`http://localhost:3000`](http://localhost:3000).
   
   **Network access:** The dev server is configured to bind to all network interfaces (`0.0.0.0`), so you can also access it from other devices on your network using your machine's IP address or Tailscale hostname (e.g., `http://your-tailscale-hostname:3000`).

## Tools

This starter app now focuses exclusively on Model Context Protocol (MCP) tooling.

- Use the sidebar to register HTTP or stdio MCP servers. Connected tools automatically appear in the model's tool list.
- Tool calls, approvals, and results stream back into the chat transcript so you can follow what the assistant is doing.
- Built-in tools (file search, web search, code interpreter) and first-party connectors have been removed to keep the surface focused on MCP. You can add them back if needed.

## Demo flows

### 1. Manage chat sessions

1. Click **New chat** in the sidebar and ask the assistant a question.
2. Open a second conversation, then switch back to the first one. The full transcript restores instantly.
3. Use **Clear conversation** to reset the active session without affecting the others.

### 2. Connect an MCP server

1. Open the **MCP Servers** card in the sidebar and add a server (for example, an HTTP endpoint exposed by `mcp-remote` or any MCP-compatible tool host).
2. Ask the model to perform a task that requires that server—for instance, "Use the exa search tool to find articles about step streaming."
3. Watch the tool call and result events stream into the transcript as the assistant works.

### 3. Observe streaming traces

Try a prompt that requires multiple steps (e.g., "Search for the latest GPU benchmarks and summarize the results."). The UI will stream:

- Assistant message chunks (live typing effect)
- MCP tool call payloads and returned data
- Reasoning snippets when the model emits them

## Contributing

You are welcome to open issues or submit PRs to improve this app, however, please note that we may not review all suggestions.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
