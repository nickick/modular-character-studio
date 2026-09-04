import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectRoot } from './project-paths'

const original = process.env.MCS_PROJECT_ROOT

afterEach(() => {
  if (original === undefined) delete process.env.MCS_PROJECT_ROOT
  else process.env.MCS_PROJECT_ROOT = original
})

describe('projectRoot', () => {
  it('defaults to the bundled project', () => {
    delete process.env.MCS_PROJECT_ROOT
    expect(projectRoot()).toBe(resolve(process.cwd(), 'project'))
  })

  it('accepts an explicit project directory', () => {
    process.env.MCS_PROJECT_ROOT = '/tmp/example-character-project'
    expect(projectRoot()).toBe('/tmp/example-character-project')
  })
})
