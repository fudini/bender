# Bendec

### Binary encoder / decoder featuring fixed-size arrays

Supports: Primitives, Structs, Enums, Unions, Arrays, Aliases

Generators: Rust, TypeScript, C++

TODO:

* ~~TypeScript definitions generator~~
* ~~Enum type~~
* Add validate function that will check the correctness  
  of the object you're trying to encode
* ~~Wrapper for types with getters and setters~~
* read-only wrappers

```js
const bendec = new Bendec({
    definitions, // todo
    getVariant   // todo
})

// get your Buffer from somewhere
const buffer = Buffer.alloc(bendec.getSize('User'))

// wrap the buffer 
const user = bendec.wrap('User', buffer)

// just get / set properties
user.firstName = 'Lorem'
// nested object
user.address.postcode = 'E1 123'

// your Buffer is now updated
console.log(buffer)

```

## Debugging and log printing

For TypeScript pretty enum values and types looking set `ENABLE_TYPE_REFERENCES=Y` to generate additional information about type.

Example:

```typescript
export enum Size {
  Small,
  Medium,
  Large
}
export namespace Size {
  type NameOfEnum = keyof typeof Size
  /// allow to use enum names 
  export const cast = (value: number | string): Size => typeof value === 'string' ? getValue(value as any) : (value as Size)
  export const getValue = (name: NameOfEnum): Size => Size[name] as any
  export const getName = (value: Size): string => Size[value] as any
  /// debug information
  export const getLabel = (value: Size): string => `${getName(value)} (value)`
}

export interface Car {
  size: Size
}
export namespace Car {
    export const size = "Size"
}
```
