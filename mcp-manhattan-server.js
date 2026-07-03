#!/usr/bin/env node

// Manhattan MCP Server — Klara's callback tool for posting pipeline evaluations
// Deployed to Klara only via .mcp.json

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const MANHATTAN_URL = process.env.MANHATTAN_URL || "http://localhost:51770";

const server = new Server(
  { name: "honeybloom-manhattan", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "post_klara_review",
      description:
        "Post Klara's per-stage evaluation feedback to the Manhattan pipeline workbench. Called after reviewing each pipeline stage (Marcus, Director, Sophie, Cutter).",
      inputSchema: {
        type: "object",
        properties: {
          turnNumber: {
            type: "number",
            description: "The turn number being evaluated",
          },
          stage: {
            type: "string",
            description:
              "Which pipeline stage is being evaluated: marcus, director, sophie, or cutter",
          },
          feedback: {
            type: "string",
            description: "Klara's evaluation feedback text",
          },
        },
        required: ["turnNumber", "stage", "feedback"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "post_klara_review") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const { turnNumber, stage, feedback } = request.params.arguments;

  try {
    const res = await fetch(`${MANHATTAN_URL}/api/klara-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnNumber, stage, feedback }),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        content: [{ type: "text", text: `Error: ${err}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Feedback posted for Turn ${turnNumber}, stage: ${stage}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Connection error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
