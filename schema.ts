/** @file Type definitions for database tables. */
import * as newtype from './newtype'
import * as reactionModule from './reaction'

// ==============
// === Schema ===
// ==============

export type UserId = newtype.Newtype<string, 'UserId'>
export type DiscordUserId = newtype.Newtype<string, 'DiscordUserId'>
export type IPAddress = newtype.Newtype<string, 'IPAddress'>
export type ThreadId = newtype.Newtype<string, 'ThreadId'>
export type MessageId = newtype.Newtype<string, 'MessageId'>

export interface User {
    id: UserId
    discordId: DiscordUserId | null
    ip: IPAddress | null
    name: string
    /** Null when the user has not yet set an avatar. */
    avatarUrl: string | null
    /** Null when the user has not yet opened their first thread. */
    currentThreadId: ThreadId | null
}

export interface Thread {
    discordThreadId: ThreadId
    userId: UserId
    title: string
    lastMessageReadId: MessageId
    lastMessageSentId: MessageId
}

export interface Message {
    discordMessageId: MessageId
    discordThreadId: ThreadId
    discordAuthorId: DiscordUserId | null
    content: string
    createdAt: number
    editedAt: number
}

export interface Reaction {
    discordMessageId: MessageId
    reaction: reactionModule.ReactionSymbol
}
