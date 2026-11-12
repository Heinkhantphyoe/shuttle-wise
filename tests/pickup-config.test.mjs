import assert from 'node:assert/strict'
import test from 'node:test'
import { pickupConfiguration } from '../src/pickup-config.ts'
import { withinPickup } from '../src/pickup.ts'

const env = {
  VITE_APU_LATITUDE: '3.055070', VITE_APU_LONGITUDE: '101.700573',
  VITE_LRT_LATITUDE: '3.058372', VITE_LRT_LONGITUDE: '101.691650',
  VITE_SAVANNA_LATITUDE: '3.0562257', VITE_SAVANNA_LONGITUDE: '101.687699',
}

test('Savanna testing uses both routes without overwriting the saved pickup points', () => {
  const original = pickupConfiguration(env)
  const temporary = pickupConfiguration({ ...env, VITE_PICKUP_PROFILE: 'savanna' })
  assert.deepEqual(temporary.savedPickups, original.pickups)
  assert.deepEqual(temporary.savedPickups.lrt, { latitude: 3.058372, longitude: 101.691650 })
  assert.equal(temporary.temporaryPickup, 'Savanna Bukit Jalil')
  for (const route of ['apu', 'lrt']) {
    assert.deepEqual(temporary.pickups[route], { latitude: 3.0562257, longitude: 101.687699 })
    assert.equal(withinPickup(temporary.pickups[route], { ...temporary.pickups[route], accuracy: 10 }), true)
    assert.equal(withinPickup(temporary.pickups[route], { ...original.pickups[route], accuracy: 10 }), false)
  }
  assert.deepEqual(pickupConfiguration(env), original)
})

test('switching back to original restores both pickup geofences', () => {
  const original = pickupConfiguration({ ...env, VITE_PICKUP_PROFILE: 'original' })
  const savanna = { latitude: 3.0562257, longitude: 101.687699, accuracy: 10 }
  assert.equal(original.temporaryPickup, undefined)
  for (const route of ['apu', 'lrt']) {
    assert.equal(withinPickup(original.pickups[route], { ...original.savedPickups[route], accuracy: 10 }), true)
    assert.equal(withinPickup(original.pickups[route], savanna), false)
  }
})

test('invalid temporary coordinates or an unknown profile disable check-in instead of using a different location', () => {
  for (const override of [{ VITE_SAVANNA_LATITUDE: '' }, { VITE_SAVANNA_LONGITUDE: '181' }, { VITE_PICKUP_PROFILE: 'savanna-typo' }]) {
    const config = pickupConfiguration({ ...env, VITE_PICKUP_PROFILE: 'savanna', ...override })
    assert.deepEqual(config.pickups, { apu: undefined, lrt: undefined })
    assert.ok(config.savedPickups.lrt)
  }
})
