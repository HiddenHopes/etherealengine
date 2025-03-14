/*
CPAL-1.0 License

The contents of this file are subject to the Common Public Attribution License
Version 1.0. (the "License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at
https://github.com/EtherealEngine/etherealengine/blob/dev/LICENSE.
The License is based on the Mozilla Public License Version 1.1, but Sections 14
and 15 have been added to cover use of software over a computer network and 
provide for limited attribution for the Original Developer. In addition, 
Exhibit A has been modified to be consistent with Exhibit B.

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the
specific language governing rights and limitations under the License.

The Original Code is Ethereal Engine.

The Original Developer is the Initial Developer. The Initial Developer of the
Original Code is the Ethereal Engine team.

All portions of the code written by the Ethereal Engine team are Copyright © 2021-2023 
Ethereal Engine. All Rights Reserved.
*/

import { useEffect } from 'react'
import { Color, ConeGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, SpotLight, TorusGeometry } from 'three'

import { getMutableState, none, useHookstate } from '@etherealengine/hyperflux'

import { matches } from '../../common/functions/MatchesUtils'
import { defineComponent, hasComponent, useComponent } from '../../ecs/functions/ComponentFunctions'
import { useEntityContext } from '../../ecs/functions/EntityFunctions'
import { RendererState } from '../../renderer/RendererState'
import { isMobileXRHeadset } from '../../xr/XRState'
import { ObjectLayers } from '../constants/ObjectLayers'
import { setObjectLayers } from '../functions/setObjectLayers'
import { addObjectToGroup, removeObjectFromGroup } from './GroupComponent'

export const SpotLightComponent = defineComponent({
  name: 'SpotLightComponent',
  jsonID: 'spot-light',

  onInit: (entity) => {
    const light = new SpotLight()
    light.target.position.set(0, -1, 0)
    light.target.name = 'light-target'
    light.add(light.target)
    if (!isMobileXRHeadset) addObjectToGroup(entity, light)
    return {
      color: new Color(),
      intensity: 10,
      range: 0,
      decay: 2,
      angle: Math.PI / 3,
      penumbra: 1,
      castShadow: false,
      shadowBias: 0.00001,
      shadowRadius: 1,
      light,
      helper: null as Object3D | null,
      helperCone: null as Mesh<ConeGeometry, MeshBasicMaterial> | null,
      helperRing: null as Mesh<TorusGeometry, MeshBasicMaterial> | null
    }
  },

  onSet: (entity, component, json) => {
    if (!json) return
    if (matches.object.test(json.color) && json.color.isColor) component.color.set(json.color)
    if (matches.string.test(json.color)) component.color.value.set(json.color)
    if (matches.number.test(json.intensity)) component.intensity.set(json.intensity)
    if (matches.number.test(json.range)) component.range.set(json.range)
    if (matches.number.test(json.decay)) component.decay.set(json.decay)
    if (matches.number.test(json.angle)) component.angle.set(json.angle)
    if (matches.number.test(json.penumbra)) component.angle.set(json.penumbra)
    if (matches.boolean.test(json.castShadow)) component.castShadow.set(json.castShadow)
    /** backwards compat */
    if (matches.number.test(json.shadowBias)) component.shadowBias.set(json.shadowBias)
    if (matches.number.test(json.shadowRadius)) component.shadowRadius.set(json.shadowRadius)
  },

  toJSON: (entity, component) => {
    return {
      color: component.color.value,
      intensity: component.intensity.value,
      range: component.range.value,
      decay: component.decay.value,
      angle: component.angle.value,
      penumbra: component.penumbra.value,
      castShadow: component.castShadow.value,
      shadowBias: component.shadowBias.value,
      shadowRadius: component.shadowRadius.value
    }
  },

  onRemove: (entity, component) => {
    if (component.light.value) removeObjectFromGroup(entity, component.light.value)
    if (component.helper.value) removeObjectFromGroup(entity, component.helper.value)
  },

  reactor: function () {
    const entity = useEntityContext()
    const renderState = useHookstate(getMutableState(RendererState))
    const debugEnabled = renderState.nodeHelperVisibility
    const light = useComponent(entity, SpotLightComponent)

    useEffect(() => {
      light.light.value.color.set(light.color.value)
      if (light.helperCone.value) light.helperCone.value.material.color = light.color.value
      if (light.helperRing.value) light.helperRing.value.material.color = light.color.value
    }, [light.color])

    useEffect(() => {
      light.light.value.intensity = light.intensity.value
    }, [light.intensity])

    useEffect(() => {
      light.light.value.distance = light.range.value
    }, [light.range])

    useEffect(() => {
      light.light.value.decay = light.decay.value
    }, [light.decay])

    useEffect(() => {
      light.light.value.angle = light.angle.value
    }, [light.angle])

    useEffect(() => {
      light.light.value.penumbra = light.penumbra.value
    }, [light.penumbra])

    useEffect(() => {
      light.light.value.shadow.bias = light.shadowBias.value
    }, [light.shadowBias])

    useEffect(() => {
      light.light.value.shadow.radius = light.shadowRadius.value
    }, [light.shadowRadius])

    useEffect(() => {
      light.light.value.castShadow = light.castShadow.value
    }, [light.castShadow])

    useEffect(() => {
      if (light.light.value.shadow.mapSize.x !== renderState.shadowMapResolution.value) {
        light.light.value.shadow.mapSize.set(
          renderState.shadowMapResolution.value,
          renderState.shadowMapResolution.value
        )
        light.light.value.shadow.map?.dispose()
        light.light.value.shadow.map = null as any
        light.light.value.shadow.camera.updateProjectionMatrix()
        light.light.value.shadow.needsUpdate = true
      }
    }, [renderState.shadowMapResolution])

    useEffect(() => {
      if (debugEnabled.value && !light.helper.value) {
        const helper = new Object3D()
        helper.name = `spotlight-helper-${entity}`

        const ring = new Mesh(new TorusGeometry(0.1, 0.025, 8, 12), new MeshBasicMaterial({ fog: false }))
        const cone = new Mesh(
          new ConeGeometry(0.25, 0.5, 8, 1, true),
          new MeshBasicMaterial({ fog: false, transparent: true, opacity: 0.5, side: DoubleSide })
        )
        helper.add(ring, cone)

        ring.rotateX(Math.PI / 2)
        cone.position.setY(-0.25)

        setObjectLayers(helper, ObjectLayers.NodeHelper)

        addObjectToGroup(entity, helper)
        light.helper.set(helper)
        light.helperRing.set(ring)
        light.helperCone.set(cone)
      }

      if (!debugEnabled.value && light.helper.value) {
        removeObjectFromGroup(entity, light.helper.value)
        light.helper.set(none)
      }
    }, [debugEnabled])

    return null
  }
})
