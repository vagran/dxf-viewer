import {registerHooks} from 'node:module'

// Match the bundler's extension resolution for existing extensionless source imports.
// The test harness requires Node >= 22.15; production code is unchanged.
registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context)
        } catch (error) {
            if (error.code === 'ERR_MODULE_NOT_FOUND' &&
                specifier.startsWith('.') && !specifier.endsWith('.js')) {
                return nextResolve(specifier + '.js', context)
            }
            throw error
        }
    }
})
