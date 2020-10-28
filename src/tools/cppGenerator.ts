/**
 * C++ code generator
 */

import * as fs from 'fs'
import { normalizeTypes } from '../utils'
import { TypeDefinition, TypeDefinitionStrict, Field } from '../'
import { Kind, StructStrict, EnumStrict, UnionStrict } from '../types'
import { hexPad } from './utils'

type TypeMapping = { [k: string]: (size: number) => string }

const cppTypeMap: { [k: string]: string } = {
  ['u8']: 'uint8_t',
  ['u16']: 'uint16_t',
  ['u32']: 'uint32_t',
  ['u64']: 'uint64_t',
  ['i8']: 'int8_t',
  ['i16']: 'int16_t',
  ['i32']: 'int32_t',
  ['i64']: 'int64_t',
}

type Options = {
  typeMapping?: TypeMapping
  attribute?: string
}

export const defaultOptions = {
  attribute: '',
}

export const defaultMapping: TypeMapping = {
  'char[]': size => `[]`,
}

const indent = (i: number) => (str: string) => {
  return '                    '.substr(-i) + str
}

const getCppType = (inName: string) => {
  return (inName in cppTypeMap) ? cppTypeMap[inName] : inName
}

const getMembers = (fields: Field[], typeMap: TypeMapping) => {
  return fields.map(field => {
    const cppType = getCppType(field.type)
    const name = (field.length) ? `${field.name}[${field.length}]` : field.name

    return `    ${cppType} ${name};`
  })
}

const getEnum = (
  { name, underlying, variants }: EnumStrict,
  attribute: string
) => {
  let separator = ''
  const variantsFields = variants.map(([key, value]) => {
    let out = `    ${separator}${key} = ${hexPad(value)}`;
    separator = ',';
    return `${out}`
  }).join('\n')

  const cppType = getCppType(underlying)
  return `${attribute}
enum class ${name}: ${cppType} {
${variantsFields}
};`
}

const getUnion = (
  { name, discriminator, members }: UnionStrict,
  discTypeDef: TypeDefinitionStrict,
  attribute: string
) => {

  const unionMembers = members.map(member => {
    return `    ${member} u${member};`
  }).join('\n')

  const union = `${attribute}
union ${name} {
${unionMembers}
};`

  return union
}

/**
 * Generate C++ interfaces from Bendec types definitions
 */
export const generateString = (
  typesDuck: TypeDefinition[],
  options: Options = defaultOptions
) => {

  const ignoredTypes = ['char']

  const types: TypeDefinitionStrict[] = normalizeTypes(typesDuck)
  const { typeMapping } = { ...defaultOptions, ...options }
  const typeMap: TypeMapping = { ...defaultMapping, ...typeMapping }

  const definitions = types.map(typeDef => {
    const typeName = getCppType(typeDef.name)

    if (typeMap[typeName]) {
      return `using ${typeName} = ${typeMap[typeName]};`
    }

    if (ignoredTypes.includes(typeName)) {
      return `// ignored: ${typeName}`
    }

    if (typeDef.kind === Kind.Primitive) {
      return `// primitive built-in: ${typeName}`
    }

    if (typeDef.kind === Kind.Alias) {
      const typeAlias = getCppType(typeDef.alias)

      return `using ${typeName} = ${typeAlias};`
    }

    if (typeDef.kind === Kind.Union) {
      // determine the type of the discriminator from one of union members
      // TODO: validate if all members have discriminator
      const memberName = typeDef.members[0]
      const memberType = <StructStrict>types.find(({ name }) => name === memberName)

      const discTypeDef = typeDef.discriminator.reduce((currentTypeDef, pathSection) => {

        if (currentTypeDef.kind !== Kind.Struct) {
          throw new Error(`The path to union discriminator can only contain Structs, ${currentTypeDef.name} is not a Struct`)
        }

        const discTypeField = (<StructStrict>currentTypeDef).fields.find(({ name }) => name === pathSection)
        return <StructStrict>types.find(({ name }) => name === discTypeField.type)
      }, memberType as TypeDefinitionStrict)

      return getUnion(typeDef, discTypeDef, options.attribute)
    }

    if (typeDef.kind === Kind.Enum) {
      return getEnum(typeDef, options.attribute)
    }

    if (typeDef.kind === Kind.Struct) {
      const members = typeDef.fields
        ? getMembers(typeDef.fields, typeMap)
        : []

      const membersString = members.join('\n')

      return `${options.attribute}
struct ${typeName} {
${membersString}

    friend std::ostream &operator << (std::ostream &, const ${typeName} &);
} __attribute__ ((packed));`
    }
  })

  const result = definitions.join('\n\n')
  return `/** GENERATED BY BENDEC TYPE GENERATOR */
  ${result}
`
}

/**
 * Generate C++ types from Bendec types definitions
 */
export const generate = (types: any[], fileName: string, options?: Options) => {
  const moduleWrapped = generateString(types, options)

  fs.writeFileSync(fileName, moduleWrapped)
  console.log(`WRITTEN: ${fileName}`)
}
