/** @file Type definitions for modules that currently don't have typings on DefinitelyTyped.
 *
 * This file MUST NOT `export {}` for the modules to be visible to other files. */

// ===========================
// === Module declarations ===
// ===========================

declare module '@eslint/js' {
    /** A set of configurations. */
    interface Config {
        rules: Record<string, unknown>
    }

    /** Preset configurations defined by ESLint. */
    interface EslintConfigs {
        all: Config
        recommended: Config
    }

    /** The default export of the module. */
    interface Default {
        configs: EslintConfigs
    }

    const DEFAULT: Default
    export default DEFAULT

    // This is exported for commonjs exports only.
    // eslint-disable-next-line no-restricted-syntax
    export const configs: Default['configs']
}

declare module 'eslint-plugin-jsdoc' {
    const DEFAULT: unknown
    export default DEFAULT
}
