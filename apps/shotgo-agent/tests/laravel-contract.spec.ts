import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SHOTGO_PROTOCOL_VERSION,
  assertMutationHeaders,
  canTransitionGeneration,
  isProtocolProblem,
  type MutationContext,
} from '../src/contracts/laravel-v1.ts'

interface ResponseSpec {
  content?: Record<string, unknown>
}

interface OperationSpec {
  description?: string
  security?: Array<Record<string, unknown>>
  parameters?: Array<Record<string, unknown>>
  requestBody?: { required?: boolean }
  responses: Record<string, ResponseSpec>
}

interface PathSpec {
  get?: OperationSpec
  post?: OperationSpec
}

interface OpenApiDocument {
  openapi: string
  info: { version: string }
  paths: Record<string, PathSpec>
  components: { headers: { ProtocolVersion: { schema: { const: string } } } }
}

interface SchemaDocument {
  $defs: Record<string, Record<string, unknown>>
}

const contractRoot = fileURLToPath(new URL('../contracts/', import.meta.url))

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, `file://${contractRoot}/`), 'utf8')) as T
}

function operation(document: OpenApiDocument, path: string, method: 'get' | 'post'): OperationSpec {
  const result = document.paths[path]?.[method]
  if (!result) throw new Error(`Missing ${method.toUpperCase()} ${path}`)
  return result
}

describe('Laravel Agent Protocol v1', () => {
  it('freezes required endpoints and a single wire version', async () => {
    const openapi = await readJson<OpenApiDocument>('openapi.json')

    expect(openapi.openapi).toBe('3.1.0')
    expect(openapi.info.version).toBe(SHOTGO_PROTOCOL_VERSION)
    expect(openapi.components.headers.ProtocolVersion.schema.const).toBe(SHOTGO_PROTOCOL_VERSION)
    expect(Object.keys(openapi.paths).sort()).toEqual(
      [
        '/api/agent/v1/canvases/{canvasId}',
        '/api/agent/v1/canvases/{canvasId}/operations',
        '/api/agent/v1/capabilities',
        '/api/agent/v1/grants',
        '/api/agent/v1/events',
        '/api/agent/v1/inference-policy',
        '/api/agent/v1/generation-quotes',
        '/api/agent/v1/generations',
        '/api/agent/v1/generations/by-client-request/{clientRequestId}',
        '/api/agent/v1/generations/{generationId}',
        '/api/agent/v1/generations/{generationId}/cancel',
        '/api/internal/agent/v1/grants/introspect',
        '/api/internal/agent/v1/generation/config',
        '/api/internal/agent/v1/inference-runtime-config',
        '/api/internal/agent/v1/inference-usage',
      ].sort(),
    )
  })

  it('reads generation configuration only through service auth plus a bound grant', async () => {
    const openapi = await readJson<OpenApiDocument>('openapi.json')
    const read = operation(openapi, '/api/internal/agent/v1/generation/config', 'post')

    expect(read.security).toContainEqual({ serviceAuth: [] })
    expect(read.description).toContain('opaque capability grant')
    expect(read.description).toContain('must not be cached')
    expect(read.requestBody?.required).toBe(true)
    expect(read.responses['200']?.content?.['application/json']).toBeDefined()

    const schema = await readJson<SchemaDocument>('schemas/laravel-v1.schema.json')
    const response = schema.$defs.GenerationConfigReadResponse as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(response.required).toContain('parameterSchemaVersion')
    expect(response.required).toContain('parameters')
    expect(response.properties.parameterSchemaVersion).toEqual({ const: 1 })
    expect(response.properties.pricing).toBeUndefined()
  })

  it('issues grants from Sanctum identity and introspects them under service authentication', async () => {
    const openapi = await readJson<OpenApiDocument>('openapi.json')
    const create = operation(openapi, '/api/agent/v1/grants', 'post')
    const introspect = operation(openapi, '/api/internal/agent/v1/grants/introspect', 'post')

    expect(create.security).toContainEqual({ sanctumAuth: [] })
    expect(create.description).toContain('derived from Sanctum')
    expect(create.responses['200']?.content?.['application/json']).toBeDefined()
    expect(introspect.security).toContainEqual({ serviceAuth: [] })
    expect(introspect.description).toContain('must not be cached')
    expect(introspect.responses['200']?.content?.['application/json']).toBeDefined()
    expect(openapi.paths['/api/internal/agent/v1/grants/exchange']).toBeUndefined()

    const schema = await readJson<SchemaDocument>('schemas/laravel-v1.schema.json')
    const createRequest = schema.$defs.AgentGrantCreateRequest as { properties: Record<string, unknown> }
    const introspection = schema.$defs.AgentGrantIntrospectionResponse as {
      properties: Record<string, { $ref?: string }>
    }
    expect(createRequest.properties.userId).toBeUndefined()
    expect(createRequest.properties.teamId).toBeUndefined()
    expect(createRequest.properties.model).toBeUndefined()
    expect(introspection.properties.teamId?.$ref).toBe('#/$defs/NullableIntegerId')
    expect(introspection.properties.inferencePolicy?.$ref).toBe('#/$defs/InferencePolicy')
    expect(introspection.properties.grantId).toBeUndefined()
    expect(introspection.properties.provider).toBeUndefined()
    expect(introspection.properties.model).toBeUndefined()
  })

  it('resolves every external schema definition reference', async () => {
    const openapi = await readJson<OpenApiDocument>('openapi.json')
    const schema = await readJson<SchemaDocument>('schemas/laravel-v1.schema.json')
    const serialized = JSON.stringify(openapi)
    const references = [...serialized.matchAll(/\.\/schemas\/laravel-v1\.schema\.json#\/\$defs\/([A-Za-z0-9]+)/g)].map(
      match => match[1],
    )

    expect(references.length).toBeGreaterThan(10)
    for (const definition of references) {
      expect(definition).toBeDefined()
      expect(schema.$defs[definition ?? '']).toBeDefined()
    }
  })

  it('requires idempotency on every business mutation', async () => {
    const openapi = await readJson<OpenApiDocument>('openapi.json')
    const operations = [
      operation(openapi, '/api/agent/v1/generation-quotes', 'post'),
      operation(openapi, '/api/agent/v1/generations', 'post'),
      operation(openapi, '/api/agent/v1/generations/{generationId}/cancel', 'post'),
      operation(openapi, '/api/agent/v1/canvases/{canvasId}/operations', 'post'),
    ]

    for (const operation of operations) {
      expect(operation.security).toContainEqual({ capabilityGrant: [] })
      expect(operation.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' })
      expect(operation.requestBody?.required).toBe(true)
    }
  })

  it('keeps direct reasoning control-plane traffic distinct from business generation', async () => {
    const openapi = await readJson<OpenApiDocument>('openapi.json')
    const policy = operation(openapi, '/api/agent/v1/inference-policy', 'get')
    const runtimeConfig = operation(openapi, '/api/internal/agent/v1/inference-runtime-config', 'get')
    const usage = operation(openapi, '/api/internal/agent/v1/inference-usage', 'post')
    const generation = operation(openapi, '/api/agent/v1/generations', 'post')

    expect(openapi.paths['/api/internal/agent/v1/inference/stream']).toBeUndefined()
    expect(policy.responses['200']?.content?.['application/json']).toBeDefined()
    expect(policy.description).toContain('never returns provider credentials')
    expect(runtimeConfig.security).toContainEqual({ serviceAuth: [] })
    expect(runtimeConfig.description).toContain('must not be cached or logged')
    expect(runtimeConfig.responses['200']?.content?.['application/json']).toBeDefined()
    expect(usage.parameters).toContainEqual({ $ref: '#/components/parameters/InferenceUsageIdempotencyKey' })
    expect(usage.description).toContain('Prompts, completions, and provider credentials are forbidden')
    expect(generation.responses['202']?.content?.['application/json']).toBeDefined()
  })

  it('enforces mutation correlation and idempotency equality', () => {
    const context: MutationContext = {
      sessionId: 'session-1',
      runId: 'run-1',
      actionId: 'action-1',
      clientRequestId: 'request-1',
    }

    expect(() => {
      assertMutationHeaders(context, { 'Idempotency-Key': 'request-1' })
    }).not.toThrow()
    expect(() => {
      assertMutationHeaders(context, { 'Idempotency-Key': 'request-2' })
    }).toThrow('SHOTGO_IDEMPOTENCY_KEY_MISMATCH')
  })

  it('permits only the frozen generation lifecycle', () => {
    expect(canTransitionGeneration('draft', 'creating')).toBe(true)
    expect(canTransitionGeneration('creating', 'queued')).toBe(true)
    expect(canTransitionGeneration('queued', 'processing')).toBe(true)
    expect(canTransitionGeneration('processing', 'completed')).toBe(true)
    expect(canTransitionGeneration('processing', 'cancelled')).toBe(true)
    expect(canTransitionGeneration('completed', 'processing')).toBe(false)
    expect(canTransitionGeneration('failed', 'queued')).toBe(false)
  })

  it('recognizes stable problem details without trusting arbitrary payloads', () => {
    expect(
      isProtocolProblem({
        type: 'https://shotgo.cn/problems/canvas-revision-conflict',
        title: 'Canvas revision conflict',
        status: 409,
        code: 'CANVAS_REVISION_CONFLICT',
        retryable: false,
        requestId: 'request-1',
      }),
    ).toBe(true)
    expect(isProtocolProblem({ status: 409, message: 'conflict' })).toBe(false)
  })
})
