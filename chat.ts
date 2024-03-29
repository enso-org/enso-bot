/** @file A WebSocket server that sends messages to and from the desktop IDE and cloud. */
import * as http from 'node:http'

import * as ws from 'ws'
import isEmail from 'validator/es/lib/isEmail'

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
    /** Like the `authenticate` message, but with user details. */
    internalAuthenticate = 'internal-authenticate',
    /** Like the `authenticateAnonymously` message, but with user details. */
    internalAuthenticateAnonymously = 'internal-authenticate-anonymously',
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
    /** Sent by a user that is not logged in. This is currently only used on the website. */
    authenticateAnonymously = 'authenticate-anonymously',
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

/** Sent to the main file with user IP. */
export interface ChatInternalAuthenticateAnonymouslyMessageData
    extends ChatBaseMessageData<ChatMessageDataType.internalAuthenticateAnonymously> {
    userId: schema.UserId
    email: schema.EmailAddress
}

export type ChatInternalMessageData =
    | ChatInternalAuthenticateAnonymouslyMessageData
    | ChatInternalAuthenticateMessageData

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

/** Sent whenever the user opens the chat sidebar. */
export interface ChatAuthenticateAnonymouslyMessageData
    extends ChatBaseMessageData<ChatMessageDataType.authenticateAnonymously> {
    email: schema.EmailAddress
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
    | ChatAuthenticateAnonymouslyMessageData
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
    ipToUser = new Map<string /* Client IP */, schema.UserId>()
    /** Required only to find the correct `ipToUser` entry to clean up. */
    userToIp = new Map<schema.UserId, string /* Client IP */>()
    userToWebsocket = new Map<schema.UserId, ws.WebSocket>()
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

            websocket.on('close', (code, reason) => {
                this.onWebSocketClose(websocket, req, code, reason)
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
        const websocket = this.userToWebsocket.get(userId)
        if (websocket == null) {
            // The user is not online. This is not an error.
            return
        } else if (websocket.readyState !== websocket.OPEN) {
            this.userToWebsocket.delete(userId)
            const ip = this.userToIp.get(userId)
            this.userToIp.delete(userId)
            if (ip != null) {
                this.ipToUser.delete(ip)
            }
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

    protected getClientAddress(request: http.IncomingMessage) {
        const rawForwardedFor = request.headers['x-forwarded-for']
        const forwardedFor =
            typeof rawForwardedFor === 'string' ? rawForwardedFor : rawForwardedFor?.[0]
        return forwardedFor?.split(',')[0]?.trim() ?? request.socket.remoteAddress
    }

    protected removeClient(request: http.IncomingMessage) {
        const clientAddress = this.getClientAddress(request)
        if (clientAddress != null) {
            const userId = this.ipToUser.get(clientAddress)
            this.ipToUser.delete(clientAddress)
            if (userId != null) {
                this.userToIp.delete(userId)
                this.userToWebsocket.delete(userId)
            }
        }
    }

    protected onWebSocketError(
        _websocket: ws.WebSocket,
        request: http.IncomingMessage,
        error: Error
    ) {
        console.error(`WebSocket error: ${error.toString()}`)
        this.removeClient(request)
    }

    protected onWebSocketClose(
        _websocket: ws.WebSocket,
        request: http.IncomingMessage,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _code: number,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _reason: Buffer
    ) {
        this.removeClient(request)
    }

    protected async onWebSocketMessage(
        websocket: ws.WebSocket,
        request: http.IncomingMessage,
        data: ws.RawData,
        isBinary: boolean
    ) {
        if (isBinary) {
            console.error('Binary messages are not supported.')
            // This is fine, as binary messages cannot be handled by this application.
            // eslint-disable-next-line no-restricted-syntax
            return
        }
        const clientAddress = this.getClientAddress(request)
        if (clientAddress != null) {
            // This acts as the server so it must not assume the message is valid.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-base-to-string
            const message: ChatClientMessageData = JSON.parse(data.toString())
            let userId = this.ipToUser.get(clientAddress)
            if (message.type === ChatMessageDataType.authenticate) {
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
                    // This is an unrecoverable error.
                    // eslint-disable-next-line no-restricted-syntax
                    return
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const userInfo: User = await userInfoRequest.json()
                userId = newtype.asNewtype<schema.UserId>(`${userInfo.id} ${userInfo.email}`)
                this.ipToUser.set(clientAddress, userId)
                this.userToIp.set(userId, clientAddress)
                this.userToWebsocket.set(userId, websocket)
                await this.messageCallback(userId, {
                    type: ChatMessageDataType.internalAuthenticate,
                    userId,
                    userName: userInfo.name,
                })
            } else if (message.type === ChatMessageDataType.authenticateAnonymously) {
                userId = newtype.asNewtype<schema.UserId>(clientAddress)
                this.ipToUser.set(clientAddress, userId)
                this.userToIp.set(userId, clientAddress)
                this.userToWebsocket.set(userId, websocket)
                if (typeof message.email !== 'string' || !isEmail(message.email)) {
                    websocket.close()
                    // This is an unrecoverable error.
                    // eslint-disable-next-line no-restricted-syntax
                    return
                }
                await this.messageCallback(userId, {
                    type: ChatMessageDataType.internalAuthenticateAnonymously,
                    userId,
                    email: message.email,
                })
            } else {
                // TODO[sb]: Is it dangerous to log client IPs?
                if (userId == null) {
                    console.error(`The client at ${clientAddress} is not authenticated.`)
                    // This is fine, as this is an unrecoverable error.
                    // eslint-disable-next-line no-restricted-syntax
                    return
                }
            }
            await this.messageCallback(userId, message)
        }
    }
}
