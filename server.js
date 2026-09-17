import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

function createMcpServer() {
  const server = new McpServer({
    name: "facebook-page-luyen",
    version: "1.0.0",
  });

  server.tool(
    "facebook_publish_post",
    "Đăng một bài viết dạng text lên Facebook Page. Chỉ sử dụng sau khi người dùng đã xác nhận nội dung muốn đăng.",
    {
      message: z.string().min(1).describe("Nội dung bài viết Facebook"),
    },
    async ({ message }) => {
      const pageId = process.env.FACEBOOK_PAGE_ID;
      const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

      if (!pageId || !accessToken) {
        return {
          content: [
            {
              type: "text",
              text: "Server chưa được cấu hình FACEBOOK_PAGE_ID hoặc FACEBOOK_PAGE_ACCESS_TOKEN.",
            },
          ],
          isError: true,
        };
      }

      try {
        const response = await fetch(
          `https://graph.facebook.com/v25.0/${pageId}/feed`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
              access_token: accessToken,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Facebook API lỗi: ${JSON.stringify(data)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Đăng bài thành công. Facebook Post ID: ${data.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Không thể kết nối Facebook Graph API: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

const transports = {};

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Facebook MCP Luyen",
    mcp_endpoint: "/mcp",
  });
});

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];

    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (!sessionId || !transports[sessionId]) {
    return res.status(400).send("Invalid or missing MCP session ID");
  }

  await transports[sessionId].handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (!sessionId || !transports[sessionId]) {
    return res.status(400).send("Invalid or missing MCP session ID");
  }

  await transports[sessionId].handleRequest(req, res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Facebook MCP running on port ${PORT}`);
});
