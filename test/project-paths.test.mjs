import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { resolve } from 'node:path'
import { projectRoot } from '../src/lib/project-paths.ts'

const original = process.env.MCS_PROJECT_ROOT

afterEach(() => {
  if (original === undefined) delete process.env.MCS_PROJECT_ROOT
  else process.env.MCS_PROJECT_ROOT = original
})

test('projectRoot defaults to the bundled project', () => {
  delete process.env.MCS_PROJECT_ROOT
  assert.equal(projectRoot(), resolve(process.cwd(), 'project'))
})

test('projectRoot accepts an explicit project directory', () => {
  process.env.MCS_PROJECT_ROOT = '/tmp/example-character-project'
  assert.equal(projectRoot(), '/tmp/example-character-project')
})
