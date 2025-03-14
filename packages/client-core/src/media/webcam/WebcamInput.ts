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

import type { FaceDetection, FaceExpressions } from '@vladmandic/face-api'
import * as Comlink from 'comlink'
import { useEffect } from 'react'

import { isDev } from '@etherealengine/common/src/config'
import { createWorkerFromCrossOriginURL } from '@etherealengine/common/src/utils/createWorkerFromCrossOriginURL'
import { AvatarRigComponent } from '@etherealengine/engine/src/avatar/components/AvatarAnimationComponent'
import { AvatarNetworkAction } from '@etherealengine/engine/src/avatar/state/AvatarNetworkState'
import { Engine } from '@etherealengine/engine/src/ecs/classes/Engine'
import { Entity } from '@etherealengine/engine/src/ecs/classes/Entity'
import {
  defineQuery,
  getComponent,
  hasComponent,
  removeQuery,
  setComponent
} from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'
import { defineSystem } from '@etherealengine/engine/src/ecs/functions/SystemFunctions'
import { WebcamInputComponent } from '@etherealengine/engine/src/input/components/WebcamInputComponent'
import { WorldNetworkAction } from '@etherealengine/engine/src/networking/functions/WorldNetworkAction'
import { GroupComponent } from '@etherealengine/engine/src/scene/components/GroupComponent'
import { UUIDComponent } from '@etherealengine/engine/src/scene/components/UUIDComponent'
import { defineActionQueue, getMutableState, removeActionQueue } from '@etherealengine/hyperflux'

import { MediaStreamState } from '../../transports/MediaStreams'

const FACE_EXPRESSION_THRESHOLD = 0.1
const PUCKER_EXPRESSION_THRESHOLD = 0.8
const OPEN_EXPRESSION_THRESHOLD = 0.5
const WIDEN_EXPRESSION_THRESHOLD = 0.5

const faceTrackingTimers: any[] = []
let lipsyncTracking = false
let audioContext: AudioContext = null!

let faceWorker: Comlink.Remote<any> = null!
let faceVideo: HTMLVideoElement = null!
let faceCanvas: OffscreenCanvas = null!

export const stopFaceTracking = () => {
  faceTrackingTimers.forEach((timer) => {
    clearInterval(timer)
  })
}

export const stopLipsyncTracking = () => {
  lipsyncTracking = false
  audioContext?.close()
  audioContext = null!
}

export const startFaceTracking = async () => {
  if (!faceWorker) {
    const workerPath = isDev
      ? // @ts-ignore - for some reason, the worker file path is not being resolved correctly
        import.meta.url.replace('.ts', 'Worker.js')
      : // @ts-ignore
        new URL('./WebcamInputWorker.js', import.meta.url).href
    const worker = createWorkerFromCrossOriginURL(workerPath, true, {
      name: 'Face API Worker'
    })
    worker.onerror = console.error
    faceWorker = Comlink.wrap(worker)
    // @ts-ignore
    await faceWorker.initialise(import.meta.env.BASE_URL)
  }

  faceVideo = document.createElement('video')

  faceVideo.addEventListener('loadeddata', async () => {
    await faceWorker.create(faceVideo.videoWidth, faceVideo.videoHeight)
    faceCanvas = new OffscreenCanvas(faceVideo.videoWidth, faceVideo.videoHeight)
    const context = faceCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    const interval = setInterval(async () => {
      context.drawImage(faceVideo, 0, 0, faceVideo.videoWidth, faceVideo.videoHeight)
      const imageData = context.getImageData(0, 0, faceVideo.videoWidth, faceVideo.videoHeight)
      const pixels = imageData.data.buffer
      const detection = await faceWorker.detect(Comlink.transfer(pixels, [pixels]))
      if (detection) {
        faceToInput(detection)
      }
    }, 100)
    faceTrackingTimers.push(interval)
  })

  faceVideo.srcObject = getMutableState(MediaStreamState).videoStream.value
  faceVideo.muted = true
  faceVideo.play()
}

export async function faceToInput(detection: { detection: FaceDetection; expressions: FaceExpressions }) {
  if (!hasComponent(Engine.instance.localClientEntity, WebcamInputComponent)) return

  const entity = Engine.instance.localClientEntity

  if (detection !== undefined && detection.expressions !== undefined) {
    for (const expression in detection.expressions) {
      const aboveThreshold = detection.expressions[expression] > FACE_EXPRESSION_THRESHOLD
      if (aboveThreshold) {
        const inputIndex = expressionByIndex.findIndex((exp) => exp === expression)!
        WebcamInputComponent.expressionIndex[entity] = inputIndex
        WebcamInputComponent.expressionValue[entity] = detection.expressions[expression]
      }
    }
  }
}

export const startLipsyncTracking = () => {
  lipsyncTracking = true
  const BoundingFrequencyMasc = [0, 400, 560, 2400, 4800]
  const BoundingFrequencyFem = [0, 500, 700, 3000, 6000]
  audioContext = new AudioContext()
  const FFT_SIZE = 1024
  const samplingFrequency = 44100
  let sensitivityPerPole
  let spectrum
  let spectrumRMS
  const IndicesFrequencyFemale: number[] = []
  const IndicesFrequencyMale: number[] = []

  for (let m = 0; m < BoundingFrequencyMasc.length; m++) {
    IndicesFrequencyMale[m] = Math.round(((2 * FFT_SIZE) / samplingFrequency) * BoundingFrequencyMasc[m])
    console.log('IndicesFrequencyMale[', m, ']', IndicesFrequencyMale[m])
  }

  for (let m = 0; m < BoundingFrequencyFem.length; m++) {
    IndicesFrequencyFemale[m] = Math.round(((2 * FFT_SIZE) / samplingFrequency) * BoundingFrequencyFem[m])
    console.log('IndicesFrequencyFemale[', m, ']', IndicesFrequencyFemale[m])
  }

  const userSpeechAnalyzer = audioContext.createAnalyser()
  userSpeechAnalyzer.smoothingTimeConstant = 0.5
  userSpeechAnalyzer.fftSize = FFT_SIZE

  const inputStream = audioContext.createMediaStreamSource(getMutableState(MediaStreamState).audioStream.value!)
  inputStream.connect(userSpeechAnalyzer)

  const audioProcessor = audioContext.createScriptProcessor(FFT_SIZE * 2, 1, 1)
  userSpeechAnalyzer.connect(audioProcessor)
  audioProcessor.connect(audioContext.destination)

  audioProcessor.onaudioprocess = () => {
    if (!lipsyncTracking || !hasComponent(Engine.instance.localClientEntity, WebcamInputComponent)) return
    // bincount returns array which is half the FFT_SIZE
    spectrum = new Float32Array(userSpeechAnalyzer.frequencyBinCount)
    // Populate frequency data for computing frequency intensities
    userSpeechAnalyzer.getFloatFrequencyData(spectrum) // getByteTimeDomainData gets volumes over the sample time
    // Populate time domain for calculating RMS
    // userSpeechAnalyzer.getFloatTimeDomainData(spectrum);
    // RMS (root mean square) is a better approximation of current input level than peak (just sampling this frame)
    // spectrumRMS = getRMS(spectrum);

    sensitivityPerPole = getSensitivityMap(spectrum)

    // Lower and higher voices have different frequency domains, so we'll separate and max them
    const EnergyBinMasc = new Float32Array(BoundingFrequencyMasc.length)
    const EnergyBinFem = new Float32Array(BoundingFrequencyFem.length)

    // Masc energy bins (groups of frequency-depending energy)
    for (let m = 0; m < BoundingFrequencyMasc.length - 1; m++) {
      for (let j = IndicesFrequencyMale[m]; j <= IndicesFrequencyMale[m + 1]; j++)
        if (sensitivityPerPole[j] > 0) EnergyBinMasc[m] += sensitivityPerPole[j]
      EnergyBinMasc[m] /= IndicesFrequencyMale[m + 1] - IndicesFrequencyMale[m]
    }

    // Fem energy bin
    for (let m = 0; m < BoundingFrequencyFem.length - 1; m++) {
      for (let j = IndicesFrequencyMale[m]; j <= IndicesFrequencyMale[m + 1]; j++)
        if (sensitivityPerPole[j] > 0) EnergyBinFem[m] += sensitivityPerPole[j]
      EnergyBinMasc[m] /= IndicesFrequencyMale[m + 1] - IndicesFrequencyMale[m]
      EnergyBinFem[m] = EnergyBinFem[m] / (IndicesFrequencyFemale[m + 1] - IndicesFrequencyFemale[m])
    }
    const pucker =
      Math.max(EnergyBinFem[1], EnergyBinMasc[1]) > 0.2
        ? 1 - 2 * Math.max(EnergyBinMasc[2], EnergyBinFem[2])
        : (1 - 2 * Math.max(EnergyBinMasc[2], EnergyBinFem[2])) * 5 * Math.max(EnergyBinMasc[1], EnergyBinFem[1])

    const widen = 3 * Math.max(EnergyBinMasc[3], EnergyBinFem[3])
    const open = 0.8 * (Math.max(EnergyBinMasc[1], EnergyBinFem[1]) - Math.max(EnergyBinMasc[3], EnergyBinFem[3]))

    const entity = Engine.instance.localClientEntity

    if (pucker > PUCKER_EXPRESSION_THRESHOLD && pucker >= WebcamInputComponent.expressionValue[entity]) {
      const inputIndex = expressionByIndex.findIndex((exp) => exp === 'pucker')!
      WebcamInputComponent.expressionIndex[entity] = inputIndex
      WebcamInputComponent.expressionValue[entity] = 1
    } else if (widen > WIDEN_EXPRESSION_THRESHOLD && widen >= WebcamInputComponent.expressionValue[entity]) {
      const inputIndex = expressionByIndex.findIndex((exp) => exp === 'widen')!
      WebcamInputComponent.expressionIndex[entity] = inputIndex
      WebcamInputComponent.expressionValue[entity] = 1
    } else if (open > OPEN_EXPRESSION_THRESHOLD && open >= WebcamInputComponent.expressionValue[entity]) {
      const inputIndex = expressionByIndex.findIndex((exp) => exp === 'open')!
      WebcamInputComponent.expressionIndex[entity] = inputIndex
      WebcamInputComponent.expressionValue[entity] = 1
    }
  }
}

function getRMS(spectrum) {
  let rms = 0
  for (let i = 0; i < spectrum.length; i++) {
    rms += spectrum[i] * spectrum[i]
  }
  rms /= spectrum.length
  rms = Math.sqrt(rms)
  return rms
}

function getSensitivityMap(spectrum) {
  const sensitivity_threshold = 0.5
  const stPSD = new Float32Array(spectrum.length)
  for (let i = 0; i < spectrum.length; i++) {
    stPSD[i] = sensitivity_threshold + (spectrum[i] + 20) / 140
  }
  return stPSD
}

const morphNameByInput = {
  neutral: 'None',
  angry: 'Frown',
  disgusted: 'Frown',
  fearful: 'Frown',
  happy: 'Smile',
  surprised: 'Frown',
  sad: 'Frown',
  pucker: 'None',
  widen: 'Frown',
  open: 'Happy'
}

const expressionByIndex = Object.keys(morphNameByInput)
const morphNameByIndex = Object.values(morphNameByInput)

const setAvatarExpression = (entity: Entity): void => {
  const morphValue = WebcamInputComponent.expressionValue[entity]
  if (morphValue === 0) return

  const morphName = morphNameByIndex[WebcamInputComponent.expressionIndex[entity]]
  const skinnedMeshes = getComponent(entity, AvatarRigComponent).skinnedMeshes

  for (const obj of skinnedMeshes) {
    if (!obj.morphTargetDictionary || !obj.morphTargetInfluences) continue

    const morphIndex = obj.morphTargetDictionary[morphName]

    if (typeof morphIndex !== 'number') {
      for (const morphName in obj.morphTargetDictionary)
        obj.morphTargetInfluences[obj.morphTargetDictionary[morphName]] = 0
      return
    }

    if (morphName && morphValue !== null) {
      if (typeof morphValue === 'number') {
        obj.morphTargetInfluences[morphIndex] = morphValue // 0.0 - 1.0
      }
    }
  }
}
const webcamQuery = defineQuery([GroupComponent, AvatarRigComponent, WebcamInputComponent])
const avatarSpawnQueue = defineActionQueue(AvatarNetworkAction.spawn.matches)

const execute = () => {
  for (const action of avatarSpawnQueue()) {
    const entity = UUIDComponent.entitiesByUUID[action.entityUUID]
    setComponent(entity, WebcamInputComponent)
  }
  for (const entity of webcamQuery()) setAvatarExpression(entity)
}

/** @todo - this system currently is not used and has been replaced by the /capture route */
export const WebcamInputSystem = defineSystem({
  uuid: 'ee.client.WebcamInputSystem',
  execute
})
