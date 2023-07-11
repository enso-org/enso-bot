/** @file A WebSocket server that sends messages to and from the desktop IDE and cloud. */
import * as http from 'node:http'

import * as ws from 'ws'

import * as newtype from './newtype'
import * as reactionModule from './reaction'
import * as schema from './schema'

// =================
// === Constants ===
// =================

/** The endpoint from which user data is retrieved. */
const USERS_ME_PATH = 'https://7aqkn3tnbc.execute-api.eu-west-1.amazonaws.com/users/me'

// ==================
// === Re-exports ===
// ==================

/** All possible emojis that can be used as a reaction on a chat message. */
export type ReactionSymbol = reactionModule.ReactionSymbol

// =======================
// === AWS Cognito API ===
// =======================

/** An email address. */
export type EmailAddress = newtype.Newtype<string, 'EmailAddress'>

/** A user of the application. */
export interface User {
    id: string
    name: string
    email: EmailAddress
}

// =====================
// === Message Types ===
// =====================

// Intentionally the same as in `database.ts`; this one is intended to be copied to the frontend.
export type ThreadId = newtype.Newtype<string, 'ThreadId'>
export type MessageId = newtype.Newtype<string, 'MessageId'>

export enum ChatMessageDataType {
    // Messages internal to the server.
    /** Like the authenticate message, but with user details. */
    internalAuthenticate = 'internal-authenticate',
    // Messages from the server to the client.
    /** Metadata for all threads associated with a user. */
    serverThreads = 'server-threads',
    /** Metadata for the currently open thread. */
    serverThread = 'server-thread',
    /** A message from the server to the client. */
    serverMessage = 'server-message',
    /** An edited message from the server to the client. */
    serverEditedMessage = 'server-edited-message',
    /** A message from the client to the server, sent from the server to the client as part of
     * the message history. */
    serverReplayedMessage = 'server-replayed-message',
    // Messages from the client to the server.
    /** The authentication token. */
    authenticate = 'authenticate',
    /** Sent when the user is requesting scrollback history. */
    historyBefore = 'history-before',
    /** Create a new thread with an initial message. */
    newThread = 'new-thread',
    /** Rename an existing thread. */
    renameThread = 'rename-thread',
    /** Change the currently active thread. */
    switchThread = 'switch-thread',
    /** A message from the client to the server. */
    message = 'message',
    /** A reaction from the client. */
    reaction = 'reaction',
    /** Removal of a reaction from the client. */
    removeReaction = 'remove-reaction',
    /** Mark a message as read. Used to determine whether to show the notification dot
     * next to a thread. */
    markAsRead = 'mark-as-read',
}

/** Properties common to all WebSocket messages. */
interface ChatBaseMessageData<Type extends ChatMessageDataType> {
    type: Type
}

// =========================
// === Internal messages ===
// =========================

/** Sent to the main file with user information. */
export interface ChatInternalAuthenticateMessageData
    extends ChatBaseMessageData<ChatMessageDataType.internalAuthenticate> {
    userId: schema.UserId
    userName: string
}

// This is supposed be a union, however it only has one member.
// eslint-disable-next-line no-restricted-syntax
export type ChatInternalMessageData = ChatInternalAuthenticateMessageData

// ======================================
// === Messages from server to client ===
// ======================================

/** Basic metadata for a single thread. */
export interface ThreadData {
    title: string
    id: ThreadId
    hasUnreadMessages: boolean
}

/** Basic metadata for a all of a user's threads. */
export interface ChatServerThreadsMessageData
    extends ChatBaseMessageData<ChatMessageDataType.serverThreads> {
    threads: ThreadData[]
}

/** All possible message types that may trigger a {@link ChatServerThreadMessageData} response. */
export type ChatServerThreadRequestType =
    | ChatMessageDataType.authenticate
    | ChatMessageDataType.historyBefore
    | ChatMessageDataType.newThread
    | ChatMessageDataType.switchThread

/** Thread details and recent messages.
 * This message is sent every time the user switches threads. */
export interface ChatServerThreadMessageData
    extends ChatBaseMessageData<ChatMessageDataType.serverThread> {
    /** The type of the message that triggered this response. */
    requestType: ChatServerThreadRequestType
    title: string
    id: ThreadId
    /** `true` if there is no more message history before these messages. */
    isAtBeginning: boolean
    messages: (ChatServerMessageMessageData | ChatServerReplayedMessageMessageData)[]
}

/** A regular chat message from the server to the client. */
export interface ChatServerMessageMessageData
    extends ChatBaseMessageData<ChatMessageDataType.serverMessage> {
    id: MessageId
    // This should not be `null` for staff, as registration is required.
    // However, it will be `null` for users that have not yet set an avatar.
    authorAvatar: string | null
    authorName: string
    content: string
    reactions: reactionModule.ReactionSymbol[]
    /** Milliseconds since the Unix epoch. */
    timestamp: number
    /** Milliseconds since the Unix epoch.
     * Should only be present when receiving message history, because new messages cannot have been
     * edited. */
    editedTimestamp: number | null
}

/** A regular edited chat message from the server to the client. */
export interface ChatServerEditedMessageMessageData
    extends ChatBaseMessageData<ChatMessageDataType.serverEditedMessage> {
    id: MessageId
    content: string
    /** Milliseconds since the Unix epoch. */
    timestamp: number
}

/** A replayed message from the client to the server. Includes the timestamp of the message. */
export interface ChatServerReplayedMessageMessageData
    extends ChatBaseMessageData<ChatMessageDataType.serverReplayedMessage> {
    id: MessageId
    content: string
    /** Milliseconds since the Unix epoch. */
    timestamp: number
}

/** A message from the server to the client. */
export type ChatServerMessageData =
    | ChatServerEditedMessageMessageData
    | ChatServerMessageMessageData
    | ChatServerReplayedMessageMessageData
    | ChatServerThreadMessageData
    | ChatServerThreadsMessageData

// ======================================
// === Messages from client to server ===
// ======================================

/** Sent whenever the user opens the chat sidebar. */
export interface ChatAuthenticateMessageData
    extends ChatBaseMessageData<ChatMessageDataType.authenticate> {
    accessToken: string
}

/** Sent when the user is requesting scrollback history. */
export interface ChatHistoryBeforeMessageData
    extends ChatBaseMessageData<ChatMessageDataType.historyBefore> {
    messageId: MessageId
}

/** Sent when the user sends a message in a new thread. */
export interface ChatNewThreadMessageData
    extends ChatBaseMessageData<ChatMessageDataType.newThread> {
    title: string
    /** Content of the first message, to reduce the number of round trips. */
    content: string
}

/** Sent when the user finishes editing the thread name in the chat title bar. */
export interface ChatRenameThreadMessageData
    extends ChatBaseMessageData<ChatMessageDataType.renameThread> {
    title: string
    threadId: ThreadId
}

/** Sent when the user picks a thread from the dropdown. */
export interface ChatSwitchThreadMessageData
    extends ChatBaseMessageData<ChatMessageDataType.switchThread> {
    threadId: ThreadId
}

/** A regular message from the client to the server. */
export interface ChatMessageMessageData extends ChatBaseMessageData<ChatMessageDataType.message> {
    threadId: ThreadId
    content: string
}

/** A reaction to a message sent by staff. */
export interface ChatReactionMessageData extends ChatBaseMessageData<ChatMessageDataType.reaction> {
    messageId: MessageId
    reaction: reactionModule.ReactionSymbol
}

/** Removal of a reaction from the client. */
export interface ChatRemoveReactionMessageData
    extends ChatBaseMessageData<ChatMessageDataType.removeReaction> {
    messageId: MessageId
    reaction: reactionModule.ReactionSymbol
}

/** Sent when the user scrolls to the bottom of a chat thread. */
export interface ChatMarkAsReadMessageData
    extends ChatBaseMessageData<ChatMessageDataType.markAsRead> {
    threadId: ThreadId
    messageId: MessageId
}

/** A message from the client to the server. */
export type ChatClientMessageData =
    | ChatAuthenticateMessageData
    | ChatHistoryBeforeMessageData
    | ChatMarkAsReadMessageData
    | ChatMessageMessageData
    | ChatNewThreadMessageData
    | ChatReactionMessageData
    | ChatRemoveReactionMessageData
    | ChatRenameThreadMessageData
    | ChatSwitchThreadMessageData

// ====================
// === CustomerChat ===
// ====================

function mustBeOverridden(name: string) {
    return () => {
        throw new Error(`${name} MUST be set.`)
    }
}

export class Chat {
    private static instance: Chat
    server: ws.WebSocketServer
    ipToUser: Record<string /* Client IP */, schema.UserId> = {}
    /** Required only to find the correct `ipToUser` entry to clean up. */
    userToIp: Record<schema.UserId, string /* Client IP */> = {}
    userToWebsocket: Record<schema.UserId, ws.WebSocket> = {}
    messageCallback: (
        userId: schema.UserId,
        message: ChatClientMessageData | ChatInternalMessageData
    ) => Promise<void> | void = mustBeOverridden('Chat.messageCallback')

    constructor(port: number) {
        this.server = new ws.WebSocketServer({ port })
        this.server.on('connection', (websocket, req) => {
            websocket.on('error', error => {
                this.onWebSocketError(websocket, req, error)
            })

            websocket.on('message', (data, isBinary) => {
                void this.onWebSocketMessage(websocket, req, data, isBinary)
            })
        })
    }

    static default(port: number) {
        // This will be `undefined` on the first run.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return (Chat.instance ??= new Chat(port))
    }

    onMessage(callback: NonNullable<typeof this.messageCallback>) {
        this.messageCallback = callback
    }

    async send(userId: schema.UserId, message: ChatServerMessageData) {
        const websocket = this.userToWebsocket[userId]
        if (websocket == null) {
            // The user is not online. This is not an error.
            return
        } else if (websocket.readyState !== websocket.OPEN) {
            // This is safe as the format of all keys are highly restricted.
            /* eslint-disable @typescript-eslint/no-dynamic-delete */
            delete this.userToWebsocket[userId]
            const ip = this.userToIp[userId]
            if (ip != null) {
                delete this.userToIp[userId]
                delete this.ipToUser[ip]
            }
            /* eslint-enable @typescript-eslint/no-dynamic-delete */
            return
        } else {
            return new Promise<void>((resolve, reject) => {
                websocket.send(JSON.stringify(message), error => {
                    if (error == null) {
                        resolve()
                    } else {
                        reject(error)
                    }
                })
            })
        }
    }

    protected onWebSocketError(
        _websocket: ws.WebSocket,
        _request: http.IncomingMessage,
        error: Error
    ) {
        console.error(`WebSocket error: ${error.toString()}`)
    }

    protected async onWebSocketMessage(
        websocket: ws.WebSocket,
        request: http.IncomingMessage,
        data: ws.RawData,
        isBinary: boolean
    ) {
        if (isBinary) {
            console.error()
        }
        const clientAddress = request.socket.remoteAddress
        if (clientAddress) {
            // This acts as the server so it must not assume the message is valid.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-base-to-string
            const message: ChatClientMessageData = JSON.parse(data.toString())
            let userId = this.ipToUser[clientAddress]
            if (message.type !== ChatMessageDataType.authenticate) {
                // TODO[sb]: Is it dangerous to log client IPs?
                if (userId == null) {
                    console.error(`The client at ${clientAddress} is not authenticated.`)
                    // This is fine, as this is an unrecoverable error.
                    // eslint-disable-next-line no-restricted-syntax
                    return
                }
            } else {
                const userInfoRequest = await fetch(USERS_ME_PATH, {
                    headers: {
                        // The names come from a third-party API and cannot be changed.
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        Authorization: `Bearer ${message.accessToken}`,
                    },
                })
                if (!userInfoRequest.ok) {
                    console.error(
                        `The client at ${clientAddress} sent an invalid authorization token.`
                    )
                    // This is fine, as this is an unrecoverable error.
                    // eslint-disable-next-line no-restricted-syntax
                    return
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const userInfo: User = await userInfoRequest.json()
                userId = newtype.asNewtype<schema.UserId>(`${userInfo.id} ${userInfo.email}`)
                this.ipToUser[clientAddress] = userId
                this.userToIp[userId] = clientAddress
                this.userToWebsocket[userId] = websocket
                await this.messageCallback(userId, {
                    type: ChatMessageDataType.internalAuthenticate,
                    userId,
                    userName: userInfo.name,
                })
            }
            await this.messageCallback(userId, message)
        }
    }
}
