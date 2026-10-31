# AST research: prompt attachments
```
server/session.ts:171:1:function promptText(content: readonly ProviderContent[]): string {
```
- promptText keeps only text parts: images and uploaded files are silently dropped; prompt.image is not advertised.
- fspec: send_input(session, text) only; receive_incoming_message(IncomingMessageInput{source_session_id, role_name, message, images}) is a supervisor channel.
