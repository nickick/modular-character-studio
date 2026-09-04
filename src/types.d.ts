declare module '*.mjs' {
  export const loadModularCharacterSnapshot: (scenePath: string) => Promise<{
    scene: unknown
    revision: string
  }>
  export const saveModularCharacterSnapshot: (input: {
    scenePath: string
    historyRoot: string
    value: unknown
    expectedRevision?: string
  }) => Promise<{ scene: unknown; revision: string }>
}
