import { keyBy, mapKeys } from 'lodash'
import {
  Kind,
  UnionStrict,
  Config,
  Lookup,
  Readers,
  Writers,
  BufferWrapper,
  TypeDefinition,
  TypeDefinitionStrict,
  VariantGetter,
  Encoder,
  Decoder,
  BufferWrapperFactory,
} from './types'

import {
  genWrapFunction,
  genWrapFunction2, // function get/set
  genReadFunction,
  genWriteFunction,
  genReadFields,
  genVariantGetter,
} from './readersWriters/index'

import {
  readers as defaultReaders,
  writers as defaultWriters,
  getTypeSize,
  normalizeTypes,
  appendNamespace,
} from './utils'

const error = new Error('You used encode/decode without specifying getVariant methods in config')

// getVariant is to be deprecated but we want to keep it for backwards compatibility
const emptyVariantGetter = {
  encode() { throw error },
  decode(buf: Buffer) { throw error }
}

const defaultConfig: Config = {
  types: [],
  readers: {},
  writers: {},
}

// To throw better errors when type hasn't been found
function assertExists<T>(d: T | undefined, typeName: string): asserts d is T {
  if (d === undefined) {
    throw new Error(`Type not found: '${typeName}'`)
  }
}

class Bendec<DefaultType = unknown> {
  private getVariant: Map<string, VariantGetter> = new Map([['default', emptyVariantGetter]])
  private lookup: Lookup = {}
  private writers: Writers = {}
  private readers: Readers = {}
  private decoders: Map<string, Decoder<unknown>> = new Map()
  private encoders: Map<string, Encoder<unknown>> = new Map()
  private wrapperFactories: Map<string, BufferWrapperFactory<unknown>> = new Map()

  private wrappers: Map<string, BufferWrapper<unknown>> = new Map()
  private wrappers2: Map<string, BufferWrapper<unknown>> = new Map()

  constructor(config: Config = defaultConfig) {

    const {
      types = [],
      readers = {},
      writers = {},
      namespace,
      getVariant,
    } = config

    this.writers = { ...defaultWriters, ...writers }
    this.readers = { ...defaultReaders, ...readers }

    this.writers = mapKeys(this.writers, (_, name) => appendNamespace(name, namespace))
    this.readers = mapKeys(this.readers, (_, name) => appendNamespace(name, namespace))

    this.addTypes(types, namespace)

    if (getVariant != undefined) {
      this.getVariant.set('default', getVariant)
    }
  }

  /**
   * Register types under given namespace or root if namespace is not given
   */
  addTypes(types: TypeDefinition[], namespace?: string) {

    types = normalizeTypes(types, this.lookup, namespace)

    const lookup = { ...this.lookup, ...keyBy(types, i => i.name) }

    types.forEach(def => {
      this.lookup[def.name] = {
        ...def,
        size: getTypeSize(lookup)(def.name)
      } as TypeDefinitionStrict
    })

    // compile all types from config
    // We're only interested in custom structs
    // So Our TypeDefinition type Union has 'kind' parameter specified
    types
      .filter(type => type.kind == Kind.Struct)
      .forEach(type => {

        let decodeFunc = <any>genReadFunction(this.readers, this.lookup, type.name)
        let encodeFunc = <any>genWriteFunction(this.writers, this.lookup, type.name)
        this.decoders.set(type.name, decodeFunc)
        this.encoders.set(type.name, encodeFunc)

        let wrapFunc = <any>genWrapFunction(this.readers, this.writers, this.lookup, type.name)

        this.wrapperFactories.set(type.name, wrapFunc)

        // instantiate with empty buffer
        let wrapInstance = wrapFunc(Buffer.alloc((<any>this.lookup[type.name]).size))

        this.wrappers.set(type.name, wrapInstance)

        let wrapFunc2 = <any>genWrapFunction2(this.readers, this.writers, this.lookup, type.name)
        // instantiate with empty buffer
        let wrapInstance2 = wrapFunc2(Buffer.alloc((<any>this.lookup[type.name]).size))

        this.wrappers2.set(type.name, wrapInstance2)
      })

    // for union types we generate the getVariant function
    types.filter((type): type is UnionStrict => type.kind == Kind.Union)
      .forEach(type => {
        if (type.members.length > 0) {
          // we need to get any variant of this union and get the reader of its discriminator
          const variantGetter = genVariantGetter(type, this.readers, this.lookup)
          this.getVariant.set(type.name, variantGetter)
        } else {
          throw new Error(`Union without variants: ${type.name}`)
        }
      })
  }

  /**
   * Decode the Buffer into an object - DEPRECATED - use decodeAs
   */
  decode<T = DefaultType>(buffer: Buffer): T {
    const typeName = this.getVariant.get('default').decode(buffer)
    return this.getDecoder<T>(typeName)(buffer)
  }

  /**
   * Encode object into Buffer - DEPRECATED - use encodeAs
   */
  encode<T = DefaultType>(obj: T, buffer?: Buffer): Buffer {
    const typeName = this.getVariant.get('default').encode(obj)
    return this.getEncoder<T>(typeName)(obj, buffer)
  }

  /**
   * Encode object into Buffer as specified type
   * This method won't use a 'getVariant' function to determine
   * what type to encode as
   */
  encodeAs<T = DefaultType>(obj: T, typeName: string, buffer?: Buffer): Buffer {
    if (this.getVariant.has(typeName)) {
      typeName = this.getVariant.get(typeName).encode(obj)
    }
    return this.getEncoder<T>(typeName)(obj, buffer)
  }

  /**
   * Decode object from Buffer as specified type
   * This method won't use a 'getVariant' function to determine
   * what type to decode from
   */
  decodeAs<T = DefaultType>(buffer: Buffer, typeName: string): T {
    if (this.getVariant.has(typeName)) {
      typeName = this.getVariant.get(typeName).decode(buffer)
    }
    return this.getDecoder<T>(typeName)(buffer)
  }

  getDecoder<T = DefaultType>(typeName: string): Decoder<T> {
    const decoder = this.decoders.get(typeName) as (Decoder<T> | undefined)
    assertExists(decoder, typeName)
    return decoder
  }

  getEncoder<T = DefaultType>(typeName: string): Encoder<T> {
    const encoder = this.encoders.get(typeName) as (Encoder<T> | undefined)
    assertExists(encoder, typeName)
    return encoder
  }

  /**
   * Wrap a buffer in a Type getter / setter
   *
   * WARNING: It will reuse a cached wrapper in the bendec instance
   * therefore you can't have 2 or more of these at the same time
   *
   * To create a new instance use method getWrapper
   *
   * TODO: typeName is stringly typed
   */
  wrap<T = DefaultType>(typeName: string, buffer: Buffer): BufferWrapper<T> {
    return (this.wrappers.get(typeName) as BufferWrapper<T>).setBuffer(buffer)
  }

  /**
   * Wrap a buffer in a Type getter / setter based on functions
   *
   * WARNING: works similar to wrap (wrapper is reused)
   */
  wrap2<T = DefaultType>(typeName: string, buffer: Buffer): BufferWrapper<T> {
    return (this.wrappers2.get(typeName) as BufferWrapper<T>).setBuffer(buffer)
  }

  /**
   * Returns a function that will create a new instance of BufferWrapper
   *
   * TODO: typeName is stringly typed
   */
  getWrapper<T = DefaultType>(typeName: string): BufferWrapper<T> {
    let buffer = Buffer.alloc(this.getSize(typeName))
    return (this.wrapperFactories.get(typeName) as BufferWrapperFactory<T>)(buffer)
  }

  /**
   * Get size in bytes of a type by name
   * TODO: stringly typed
   */
  getSize(typeName: string): number {
    return (<any>this.lookup[typeName]).size
  }
}

export { Bendec }
