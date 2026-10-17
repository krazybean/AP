# AP and MCP

AP and [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) solve different problems.

**MCP defines how an AI host interacts with a capability server. AP provides the traffic path and public boundary that can make private AI-facing services reachable.**

## Side-by-side topology

<table>
<tr>
<th width="50%">Model Context Protocol (MCP)</th>
<th width="50%">AI Proxy (AP)</th>
</tr>
<tr>
<td valign="top"><pre>
┌────────────────────┐
│ AI host            │
│ Claude / IDE / app │
│                    │
│  ┌──────────────┐  │
│  │ MCP client   │  │
│  └──────┬───────┘  │
└─────────┼──────────┘
          │
          │ MCP
          │ stdio or HTTP
          ▼
   ┌──────────────┐
   │ MCP server   │
   │ tools        │
   │ resources    │
   │ prompts      │
   └──────────────┘
</pre>
<strong>Primary question:</strong><br><br>
How does the AI application interact with this capability server?
</td>
<td valign="top"><pre>
┌────────────────────┐
│ AI client / agent  │
└─────────┬──────────┘
          │
          │ normal HTTPS
          ▼
   ┌──────────────┐
   │      AP      │
   │ public edge  │
   └──────┬───────┘
          │
          │ outbound uplink
          ▼
   ┌──────────────┐
   │ private app  │
   │ capabilities │
   └──────────────┘
</pre>
<strong>Primary question:</strong><br><br>
How does traffic reach this private capability without exposing the private network?
</td>
</tr>
</table>

MCP is a protocol for exposing and consuming tools, resources, prompts, and related capabilities between MCP clients and servers. AP is transport and routing infrastructure around AI-facing services.

The MCP diagram above is logical topology: an MCP server may be local or remote, and MCP supports more than one transport. AP's concern is different — reachability, traffic flow, and eventually routing policy around those services.

## They can work together

```text
AI host
  │
  │ MCP
  ▼
MCP client
  │
  │ HTTPS
  ▼
 AP
  │
  │ private uplink
  ▼
MCP-capable private service
```

AP does not need to replace MCP. A future AP protocol adapter can route MCP traffic just as AP can route other AI-facing traffic.

