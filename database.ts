/** @file Handles loading and storing data. */
import sqlite from 'better-sqlite3'

import * as reactionModule from './reaction'
import * as schema from './schema'

// ==================
// === Re-exports ===
// ==================

/** All possible emojis that can be used as a reaction on a chat message. */
export type ReactionSymbol = reactionModule.ReactionSymbol

// ================
// === Database ===
// ================

/** A typed wrapper around sqlite. */
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
    private readonly getThreadLastMessagesBeforeStatement: sqlite.Statement
    private readonly createReactionStatement: sqlite.Statement
    private readonly getReactionsStatement: sqlite.Statement
    private readonly deleteReactionStatement: sqlite.Statement

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
        this.getThreadLastMessagesStatement = this.database.prepare(`
            SELECT * FROM (
                SELECT * FROM messages WHERE discordThreadId = ?
                    ORDER BY discordMessageId DESC LIMIT ?
            ) ORDER BY discordMessageId ASC;
        `)
        this.getThreadLastMessagesBeforeStatement = this.database.prepare(`
            SELECT * FROM (
                SELECT * FROM messages WHERE discordThreadId = ? AND discordMessageId < ?
                    ORDER BY discordMessageId DESC LIMIT ?
            ) ORDER BY discordMessageId ASC;
        `)
        this.createReactionStatement = this.database.prepare(
            'INSERT INTO reactions (discordMessageId, reaction) VALUES (?, ?);'
        )
        this.getReactionsStatement = this.database.prepare(`
            SELECT reactions.discordMessageId, reaction FROM messages
                RIGHT JOIN reactions ON messages.discordMessageId = reactions.discordMessageId
                WHERE discordThreadId = ? AND messages.discordMessageId >= ?
                    AND messages.discordMessageId <= ?;
        `)
        this.deleteReactionStatement = this.database.prepare(
            'DELETE FROM reactions WHERE discordMessageId = ? AND reaction = ?;'
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
            CREATE TABLE IF NOT EXISTS reactions (
                discordMessageId VARCHAR(25),
                reaction VARCHAR(8),
                PRIMARY KEY (discordMessageId, reaction)
            );
        `)
    }

    createUser(user: schema.User): schema.User {
        this.createUserStatement.run(
            user.id,
            user.discordId,
            user.name,
            user.avatarUrl,
            user.currentThreadId
        )
        return user
    }

    getUser(userId: schema.UserId): schema.User {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getUserStatement.get(userId) as schema.User
    }

    getUserByDiscordId(discordUserId: schema.DiscordUserId): schema.User | null {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return (this.getUserByDiscordIdStatement.get(discordUserId) ?? null) as schema.User | null
    }

    updateUser(userId: schema.UserId, fn: (user: schema.User) => schema.User): schema.User {
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

    hasUser(userId: schema.UserId): boolean {
        return this.hasUserStatement.all(userId).length !== 0
    }

    createThread(thread: schema.Thread): schema.Thread {
        this.createThreadStatement.run(
            thread.discordThreadId,
            thread.userId,
            thread.title,
            thread.lastMessageSentId,
            thread.lastMessageReadId
        )
        return thread
    }

    getThread(threadId: schema.ThreadId): schema.Thread {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getThreadStatement.get(threadId) as schema.Thread
    }

    updateThread(
        threadId: schema.ThreadId,
        fn: (data: schema.Thread) => schema.Thread
    ): schema.Thread {
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

    hasThread(threadId: schema.ThreadId): boolean {
        return this.hasThreadStatement.all(threadId).length !== 0
    }

    createMessage(message: schema.Message): schema.Message {
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

    getMessage(messageId: schema.MessageId): schema.Message {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getMessageStatement.get(messageId) as schema.Message
    }

    updateMessage(
        messageId: schema.MessageId,
        fn: (data: schema.Message) => schema.Message
    ): schema.Message {
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

    getUserThreads(userId: schema.UserId): schema.Thread[] {
        // This is safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getUserThreadsStatement.all(userId) as schema.Thread[]
    }

    getThreadLastMessages(
        threadId: schema.ThreadId,
        limit: number,
        getBefore: schema.MessageId | null
    ): schema.Message[] {
        if (getBefore != null) {
            // These type assertions are safe as the schema is known statically.
            // eslint-disable-next-line no-restricted-syntax
            return this.getThreadLastMessagesBeforeStatement.all(
                threadId,
                getBefore,
                limit
            ) as schema.Message[]
        } else {
            // eslint-disable-next-line no-restricted-syntax
            return this.getThreadLastMessagesStatement.all(threadId, limit) as schema.Message[]
        }
    }

    createReaction(reaction: schema.Reaction): schema.Reaction {
        this.createReactionStatement.run(reaction.discordMessageId, reaction.reaction)
        return reaction
    }

    getReactions(
        threadId: schema.ThreadId,
        startMessageId: schema.MessageId,
        endMessageId: schema.MessageId
    ) {
        // This type assertion is type safe as the schema is known statically.
        // eslint-disable-next-line no-restricted-syntax
        return this.getReactionsStatement.all(
            threadId,
            startMessageId,
            endMessageId
        ) as schema.Reaction[]
    }

    deleteReaction(reaction: schema.Reaction): schema.Reaction {
        this.deleteReactionStatement.run(reaction.discordMessageId, reaction.reaction)
        return reaction
    }
}
