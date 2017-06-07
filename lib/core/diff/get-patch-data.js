import {diffJson} from 'diff'
import { flatten } from 'lodash'

import patchUtils from './helpers/patches'

const isFieldPath = (path) => /^\/fields\/[^/]+$/.test(path)
const isDeletedPropertyPath = (path) => /^\/fields\/\w+\/deleted$/.test(path)
const isOmittedPropertyPath = (path) => /^\/fields\/\w+\/omitted$/.test(path)

const isFieldDeletion = ({ op, path, value }) => {
  // Field was completely removed
  if (op === 'remove' && isFieldPath(path)) {
    return true
  }
  // `deleted` was added
  if (op === 'add' && isDeletedPropertyPath(path)) {
    return true
  }
  // `deleted` was `false` and changed to `true`
  if (op === 'replace' && isDeletedPropertyPath(path) && value === true) {
    return true
  }

  return false
}

const isFieldOmission = ({ op, path, value }) => {
  // `omitted` was added
  if (op === 'add' && isOmittedPropertyPath(path)) {
    return true
  }
  // `omitted` was `false` and changed to `true`
  if (op === 'replace' && isOmittedPropertyPath(path) && value === true) {
    return true
  }

  return false
}

const isFieldAddition = ({ op, path, value }) => {
  return !isFieldDeletion({ op, path, value }) &&
         !isFieldOmission({ op, path, value }) &&
         op === 'add' && isFieldPath(path)
}

const isOther = (patch) => {
  return !isFieldAddition(patch) &&
         !isFieldDeletion(patch) &&
         !isFieldOmission(patch)
}

const removalsToDeleteOps = (data) => {
  const result = data.map((currentPatch) => {
    // path examples to match `/fields/0` or `/fields/-`
    if (currentPatch.op === 'remove' && currentPatch.path.match(/^\/fields\/(?:[^/]+)$/)) {
      return [
        {op: 'replace', path: `${currentPatch.path}/omitted`, value: true},
        {op: 'add', path: `${currentPatch.path}/deleted`, value: true}
      ]
    }
    return currentPatch
  })
  return flatten(result)
}

export function getDiffDataForPatch (tmp, target) {
  return {
    name: tmp.name,
    diff: diffJson(target, tmp).filter(part => part.value !== '{}')
  }
}

export function getPatchData (first, second) {
  const [base, target] = patchUtils.cleanupModels([first, second])

  const changes = patchUtils.compareAsObject(base, target)

  // Since a diff between two CTs will result in a `remove` op for all fields no longer present,
  // but the API needs to do it in a two step process with an omission first,
  // go ahead and turn all removals into a `omit` and `delete` sequence
  const normalizedChanges = removalsToDeleteOps(changes)

  const deletions = normalizedChanges.filter(isFieldDeletion)
  const omissions = normalizedChanges.filter(isFieldOmission)
  // Only append to fields
  const additions = normalizedChanges.filter(isFieldAddition)
    .map((patch) => ({ ...patch, path: '/fields/-' }))
  const other = normalizedChanges.filter((patch) => isOther(patch))

  // Restore the wanted fields order by moving added fields to proper position
  const baseFieldsOrder = patchUtils.fields(base).map(({ id }) => id)
  const targetFieldsOrder = patchUtils.fields(target).map(({ id }) => id)

  const currentFieldsOrder = patchUtils.getCurrentFieldsOrder(baseFieldsOrder, deletions, additions)
  const moves = patchUtils.getMovePatches(currentFieldsOrder, targetFieldsOrder)

  const patches = [...omissions, ...deletions, ...additions, ...other, ...moves]

  return patches
}