## Messages

### Client to Server

- `authenticate` - log in via token
- `message`
- `new-thread` - sent with the name of the thread, and the contents of the first
  message
- `rename-thread` - sent with the thread id, and the new name

### Server to Client

- `thread` - sent when first logging in, and when changing and creating threads.
  contains thread id.
- `server-message` - sent when a Discord message is forwarded

## Standard flows

### Authentication

```mermaid
sequenceDiagram
  Client->>+Bot: <authenticate> (token)
  Bot->>+Client: <thread> (title + chat history)
```

### Communication with Discord

```mermaid
sequenceDiagram
  Client->>+Bot: <message>
  Bot->>+Discord: message
  Discord->>+Bot: reply
  Bot->>+Client: <server-message>
  Discord->>+Bot: edit
  Bot->>+Client: <edited-message>
  Discord->>+Bot: send command
  Bot->>+Discord: generated message
  Bot->>+Client: <server-message>
```

### Thread manipulation

#### New thread

```mermaid
sequenceDiagram
  Client->>+Bot: <new-thread> (title + message)
  Bot->>+Discord: create new thread
  Discord->>+Bot: thread id
  Bot->>+DB: associate thread id with user
  Bot->>+Client: TODO: success response?
```

#### Rename thread

```mermaid
sequenceDiagram
  Client->>+Bot: <rename-thread> (id + title)
  Bot->>+Discord: rename thread
  Bot->>+DB: edit thread info
  Bot->>+Client: TODO: success response?
```

## Error flows

```mermaid
sequenceDiagram
  Client->>+Bot: <message>
  Bot->>+Client: error: not authenticated
```
