# AST research: strict daemon JSON decoding (FSPEC-068)

```
$ fspec astgrep --lang typescript --path server/transcript-json.ts --pattern 'str($A)'
server/transcript-json.ts:63:17:str(value)
server/transcript-json.ts:89:36:str(body["text"])
server/transcript-json.ts:91:44:str(body["thinking"])
server/transcript-json.ts:96:25:str(call["id"])
server/transcript-json.ts:96:48:str(call["name"])
server/transcript-json.ts:96:74:str(call["input"])
server/transcript-json.ts:105:23:str(result["tool_call_id"])
server/transcript-json.ts:106:20:str(result["content"])
server/transcript-json.ts:117:23:str(progress["tool_call_id"])
server/transcript-json.ts:118:21:str(progress["tool_name"])
server/transcript-json.ts:119:24:str(progress["output_chunk"])
server/transcript-json.ts:128:18:str(body["message"])
server/transcript-json.ts:164:38:str(body["error"])
server/transcript-json.ts:166:41:str(body["text"])
server/transcript-json.ts:188:28:str(p["phase"])
server/transcript-json.ts:195:17:str(body["reason"])

```

```
$ fspec astgrep --lang typescript --path server/transcript-json.ts --pattern 'num($A)'
server/transcript-json.ts:138:24:num(tokens["input_tokens"])
server/transcript-json.ts:139:25:num(tokens["output_tokens"])
server/transcript-json.ts:154:27:num(fill["fill_percentage"])
server/transcript-json.ts:155:28:num(fill["effective_tokens"])
server/transcript-json.ts:156:22:num(fill["threshold"])
server/transcript-json.ts:157:26:num(fill["context_window"])
server/transcript-json.ts:172:27:num(result["original_tokens"])
server/transcript-json.ts:173:28:num(result["compacted_tokens"])
server/transcript-json.ts:174:29:num(result["compression_ratio"])
server/transcript-json.ts:175:28:num(result["turns_summarized"])
server/transcript-json.ts:176:22:num(result["turns_kept"])
server/transcript-json.ts:188:54:num(p["current"])
server/transcript-json.ts:188:80:num(p["total"])

```

```
$ fspec astgrep --lang typescript --path server/interactions.ts --pattern 'record($A) ?? {}'
server/interactions.ts:78:20:record(JSON.parse(json)) ?? {}
server/interactions.ts:100:26:record(raw) ?? {}
server/interactions.ts:174:19:record(raw) ?? {}

```

