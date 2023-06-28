/** @file Handles loading and storing data. */
import sqlite from 'better-sqlite3'

import * as newtype from './newtype.js'

// ==============
// === Tables ===
// ==============

export type UserId = newtype.Newtype<string, 'UserId'>
export type DiscordUserId = newtype.Newtype<string, 'DiscordUserId'>
export type ThreadId = newtype.Newtype<string, 'ThreadId'>
export type MessageId = newtype.Newtype<string, 'MessageId'>

export interface User {
    id: UserId
    discordId: DiscordUserId | null
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

// ================
// === Database ===
// ================

export class Database {
    private readonly database: sqlite.Database
    private readonly getUserStatement: sqlite.Statement
    private readonly getUserByDiscordIdStatement: sqlite.Statement
    private readonly createUserStatement: sqlite.Statement
    private readonly updateUserStatement: sqlite.Statement
    private readonly hasUserStatement: sqlite.Statement
    private readonly createThreadStatement: sqlite.Statement
    private readonly getThreadStatement: sqlite.Statement
    private readonly updateThreadStatement: sqlite.Statement
    private readonly hasThreadStatement: sqlite.Statement
    private readonly createMessageStatement: sqlite.Statement
    private readonly getMessageStatement: sqlite.Statement
    private readonly updateMessageStatement: sqlite.Statement
    private readonly getUserThreadsStatement: sqlite.Statement
    private readonly getThreadLastMessagesStatement: sqlite.Statement

    constructor(/** Path to the file in which the data is stored. */ path: string) {
        this.database = sqlite(path)
        this.init()
        this.createUserStatement = this.database.prepare(
            'INSERT INTO users (id, discordId, name, avatarUrl, currentThreadId) VALUES (?, ?, ?, ?, ?);'
        )
        this.getUserStatement = this.database.prepare('SELECT * FROM users WHERE id = ? LIMIT 1;')
        this.getUserByDiscordIdStatement = this.database.prepare(
            'SELECT * FROM users WHERE discordId = ? LIMIT 1;'
        )
        this.updateUserStatement = this.database.prepare(
            'UPDATE users SET discordId=?, name=?, avatarUrl=?, currentThreadId=? WHERE id=?;'
        )
        this.hasUserStatement = this.database.prepare('SELECT 1 FROM users WHERE id=? LIMIT 1;')
        this.createThreadStatement = this.database.prepare(`
            INSERT INTO threads
                (discordThreadId, userId, title, lastMessageSentId, lastMessageReadId)
                VALUES (?, ?, ?, ?, ?);
        `)
        this.getThreadStatement = this.database.prepare(
            'SELECT * FROM threads WHERE discordThreadId = ? LIMIT 1;'
        )
        this.updateThreadStatement = this.database.prepare(`
            UPDATE threads SET userId=?, title=?, lastMessageSentId=?, lastMessageReadId=?
                WHERE discordThreadId=?;
        `)
        this.hasThreadStatement = this.database.prepare(
            'SELECT 1 FROM threads WHERE discordThreadId=? LIMIT 1;'
        )
        this.createMessageStatement = this.database.prepare(`
            INSERT INTO messages
                (discordMessageId, discordThreadId, discordAuthorId, content, createdAt, editedAt)
                VALUES (?, ?, ?, ?, ?, ?);
        `)
        this.getMessageStatement = this.database.prepare(
            'SELECT * FROM messages WHERE discordMessageId = ? LIMIT 1;'
        )
        this.updateMessageStatement = this.database.prepare(`
            UPDATE messages SET discordThreadId=?, discordAuthorId=?, content=?, createdAt=?,
                editedAt=? WHERE discordMessageId=?;
        `)
        this.getUserThreadsStatement = this.database.prepare(
            'SELECT * from threads WHERE userId = ?;'
        )
        this.getThreadLastMessagesStatement = this.database.prepare(
            'SELECT * FROM messages WHERE discordThreadId = ? LIMIT ?;'
        )
    }

    init() {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(40) PRIMARY KEY,
                discordId VARCHAR(32) UNIQUE,
                name VARCHAR(100) NOT NULL,
                avatarUrl TEXT,
                currentThreadId VARCHAR(25)
            );
            CREATE TABLE IF NOT EXISTS threads (
                discordThreadId VARCHAR(25) PRIMARY KEY,
                userId VARCHAR(40) NOT NULL,
                title VARCHAR(100) NOT NULL, -- hard limit defined by Discord
                lastMessageSentId VARCHAR(25) NOT NULL,
                lastMessageReadId VARCHAR(25) NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                discordMessageId VARCHAR(25) PRIMARY KEY,
                discordThreadId VARCHAR(25) NOT NULL,
                discordAuthorId VARCHAR(25), -- is NULL when the user is the author
                content TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                editedAt INTEGER NOT NULL
            );
        `)
    }

    createUser(user: User): User {
        this.createUserStatement.run(
            user.id,
            user.discordId,
            user.name,
            user.avatarUrl,
            user.currentThreadId
        )
        return user
    }

    getUser(userId: UserId): User {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getUserStatement.get(userId) as User
    }

    getUserByDiscordId(discordUserId: DiscordUserId): User | null {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return (this.getUserByDiscordIdStatement.get(discordUserId) ?? null) as User | null
    }

    updateUser(userId: UserId, fn: (user: User) => User): User {
        const newUser = fn(this.getUser(userId))
        this.updateUserStatement.run(
            newUser.discordId,
            newUser.name,
            newUser.avatarUrl,
            newUser.currentThreadId,
            userId
        )
        return newUser
    }

    hasUser(userId: UserId): boolean {
        return this.hasUserStatement.all(userId).length !== 0
    }

    createThread(thread: Thread): Thread {
        this.createThreadStatement.run(
            thread.discordThreadId,
            thread.userId,
            thread.title,
            thread.lastMessageSentId,
            thread.lastMessageReadId
        )
        return thread
    }

    getThread(threadId: ThreadId): Thread {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getThreadStatement.get(threadId) as Thread
    }

    updateThread(threadId: ThreadId, fn: (data: Thread) => Thread): Thread {
        const newThread = fn(this.getThread(threadId))
        this.updateThreadStatement.run(
            newThread.userId,
            newThread.title,
            newThread.lastMessageSentId,
            newThread.lastMessageReadId,
            threadId
        )
        return newThread
    }

    hasThread(threadId: ThreadId): boolean {
        return this.hasThreadStatement.all(threadId).length !== 0
    }

    createMessage(message: Message): Message {
        this.createMessageStatement.run(
            message.discordMessageId,
            message.discordThreadId,
            message.discordAuthorId,
            message.content,
            message.createdAt,
            message.editedAt
        )
        return message
    }

    getMessage(messageId: MessageId): Message {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getMessageStatement.get(messageId) as Message
    }

    updateMessage(messageId: MessageId, fn: (data: Message) => Message): Message {
        const newMessage = fn(this.getMessage(messageId))
        this.updateMessageStatement.run(
            newMessage.discordThreadId,
            newMessage.discordAuthorId,
            newMessage.content,
            newMessage.createdAt,
            newMessage.editedAt,
            messageId
        )
        return newMessage
    }

    getUserThreads(userId: UserId): Thread[] {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getUserThreadsStatement.all(userId) as Thread[]
    }

    getThreadLastMessages(threadId: ThreadId, limit: number): Message[] {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getThreadLastMessagesStatement.all(threadId, limit) as Message[]
    }
}
