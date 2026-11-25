/**
 * decodED's two inks over NZA Sim's 3D, drawn as a screen-space pass from a depth and normal pass (no edge lines per
 * segment). Adapted from decodED's twin/render/post/outline.js (Brief 50 B1/B2 and its footing follow-up), cut to the
 * one building NZA Sim shows:
 *
 * - the thick ink (decodED `--ink-silhouette`, about 1.75 CSS px) only where the building meets what is behind it,
 *   the background or the ground (its footing included);
 * - the thin ink (`--ink-crease`, about 0.85 CSS px) where its faces turn (a normal crease) or depth jumps within the
 *   building (eaves over walls, a wing over a wing, reveals, slabs). A depth step with more building behind it is
 *   always thin, so internal roof lines are never thick.
 *
 * Every mesh is the building unless it says `userData.ink = 'ground'` (the ground plane) or `'none'` (left out of the
 * normal pass, e.g. a wash drawn over a floor). See-through meshes are left out of the normal pass too, so the walls
 * behind a see-through roof keep their lines. Lines, points and HTML are not touched.
 *
 * Mount inside a <Canvas flat>: it takes over the frame (useFrame priority 1), so the canvas draws through it.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { LOOK } from './sketch'

/** The normal pass's alpha byte: 0 the background, 31 the building, 63 the ground. */
const BUILDING = 31 / 255
const GROUND = 63 / 255

const InkShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    /** x = the thick ink's width, y = the thin ink's, in device pixels. */
    uWeights: { value: new THREE.Vector2(LOOK.outlinePx, LOOK.creasePx) },
    /** decodED's building settings: depth 0.012, crease 0.12 (every roof junction inked), opacity 1. */
    uDepthT: { value: 0.012 },
    uNormalT: { value: 0.12 },
    uColor: { value: new THREE.Color(LOOK.outline) },
    uCreaseColor: { value: new THREE.Color(LOOK.crease) },
    uOrtho: { value: 0 },
    uNear: { value: 0.1 },
    uFar: { value: 2000 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform vec2 uWeights;
    uniform float uDepthT;
    uniform float uNormalT;
    uniform vec3 uColor;
    uniform vec3 uCreaseColor;
    uniform float uOrtho;
    uniform float uNear;
    uniform float uFar;
    varying vec2 vUv;

    float viewDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return uOrtho > 0.5 ? -orthographicDepthToViewZ(d, uNear, uFar) : -perspectiveDepthToViewZ(d, uNear, uFar);
    }
    vec3 viewNormal(vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
    /** -1 the background, 0 the building, 1 the ground. */
    int groupAt(vec2 uv) {
      float b = floor(texture2D(tNormal, uv).a * 255.0 + 0.5);
      if (b < 0.5) return -1;
      return b > 47.0 ? 1 : 0;
    }
    /** Second difference of depth (Roberts cross): on any plane the opposite taps' mean is the centre's. */
    float depthEdgeAt(float r, float dc) {
      vec2 o = uTexel * r;
      float d0 = viewDepth(vUv + vec2(-o.x, -o.y)), d1 = viewDepth(vUv + vec2(o.x, o.y));
      float d2 = viewDepth(vUv + vec2(-o.x, o.y)), d3 = viewDepth(vUv + vec2(o.x, -o.y));
      return (abs((d0 + d1) * 0.5 - dc) + abs((d2 + d3) * 0.5 - dc)) / max(dc, 1.0);
    }
    float normalEdgeAt(float r) {
      vec2 o = uTexel * r;
      vec3 n0 = viewNormal(vUv + vec2(-o.x, -o.y)), n1 = viewNormal(vUv + vec2(o.x, o.y));
      vec3 n2 = viewNormal(vUv + vec2(-o.x, o.y)), n3 = viewNormal(vUv + vec2(o.x, -o.y));
      return (1.0 - dot(n1, n0)) + (1.0 - dot(n3, n2));
    }
    /** The near side of a depth step owns the line; it is the envelope when what lies behind is not the building. */
    float envelopeAt(float r, float dc) {
      vec2 o = uTexel * r;
      vec2 taps[4];
      taps[0] = vUv + vec2(-o.x, -o.y); taps[1] = vUv + vec2(o.x, o.y);
      taps[2] = vUv + vec2(-o.x, o.y);  taps[3] = vUv + vec2(o.x, -o.y);
      float env = 0.0;
      for (int i = 0; i < 4; i++) {
        float d = viewDepth(taps[i]);
        if (d <= dc + uDepthT * max(dc, 1.0)) continue;
        if (groupAt(taps[i]) != 0) env = 1.0;
      }
      return env;
    }
    /** The footing: ground beside a building pixel at or in front of its depth (decodED, 26 Oct). */
    float footingAt(float r, float dc) {
      vec2 o = uTexel * r;
      vec2 taps[4];
      taps[0] = vUv + vec2(-o.x, -o.y); taps[1] = vUv + vec2(o.x, o.y);
      taps[2] = vUv + vec2(-o.x, o.y);  taps[3] = vUv + vec2(o.x, -o.y);
      for (int i = 0; i < 4; i++) {
        if (groupAt(taps[i]) != 1) continue;
        if (viewDepth(taps[i]) <= dc + uDepthT * max(dc, 1.0)) return 1.0;
      }
      return 0.0;
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (groupAt(vUv) != 0) { gl_FragColor = base; return; }
      float dc = viewDepth(vUv);
      float edge = step(uDepthT, depthEdgeAt(uWeights.x, dc));
      float envelopeInk = max(edge * envelopeAt(uWeights.x, dc), footingAt(uWeights.x, dc));
      float edgeThin = step(uDepthT, depthEdgeAt(uWeights.y, dc));
      float depthDetail = edgeThin * (1.0 - envelopeAt(uWeights.y, dc));
      float crease = step(uNormalT, normalEdgeAt(uWeights.y)) * (1.0 - edgeThin);
      float detailInk = max(crease, depthDetail);
      vec3 inked = mix(base.rgb, uCreaseColor, detailInk);
      gl_FragColor = vec4(mix(inked, uColor, envelopeInk), base.a);
    }
  `,
}

function createInk(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const size = gl.getSize(new THREE.Vector2())
  const dpr = gl.getPixelRatio()
  const normalTarget = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.UnsignedByteType })
  normalTarget.depthTexture = new THREE.DepthTexture(size.x * dpr, size.y * dpr)
  normalTarget.depthTexture.type = THREE.UnsignedIntType
  // NoBlending keeps the id in the alpha (three's OPAQUE define would write 1.0 over it, decodED's lesson).
  const mk = (id: number) => new THREE.MeshNormalMaterial({ opacity: id, transparent: false, blending: THREE.NoBlending, side: THREE.DoubleSide })
  const building = mk(BUILDING)
  const ground = mk(GROUND)
  const beauty = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, { type: THREE.HalfFloatType })
  const composer = new EffectComposer(gl, beauty)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)
  const pass = new ShaderPass(InkShader)
  pass.uniforms.tNormal!.value = normalTarget.texture
  pass.uniforms.tDepth!.value = normalTarget.depthTexture
  composer.addPass(pass)
  composer.addPass(new OutputPass())
  const fxaa = new ShaderPass(FXAAShader)
  composer.addPass(fxaa)
  const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[], boolean]> = []

  const setSize = (w: number, h: number, ratio: number) => {
    composer.setPixelRatio(ratio)
    composer.setSize(w, h)
    normalTarget.setSize(w * ratio, h * ratio)
    pass.uniforms.uTexel!.value.set(1 / (w * ratio), 1 / (h * ratio))
    fxaa.material.uniforms.resolution!.value.set(1 / (w * ratio), 1 / (h * ratio))
    // decodED's widths are CSS pixels, times the render's pixel ratio.
    pass.uniforms.uWeights!.value.set(LOOK.outlinePx * ratio, LOOK.creasePx * ratio)
  }
  const render = (cam: THREE.Camera) => {
    renderPass.camera = cam
    const bg = scene.background
    scene.background = null
    swapped.length = 0
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      // Lines and points are not the building: hidden from the normal pass, or their colour would read as an id.
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) { swapped.push([m, m.material, m.visible]); m.visible = false; return }
      if (!m.isMesh) return
      const mat = m.material as THREE.Material
      const kind = o.userData.ink as string | undefined
      const leave = kind === 'none' || (!Array.isArray(mat) && mat.transparent && mat.opacity < 1)
      swapped.push([m, m.material, m.visible])
      if (leave) m.visible = false
      else m.material = kind === 'ground' ? ground : building
    })
    gl.setRenderTarget(normalTarget)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(scene, cam)
    for (const [m, mat, vis] of swapped) { m.material = mat; m.visible = vis }
    scene.background = bg
    gl.setRenderTarget(null)
    const c = cam as THREE.PerspectiveCamera
    pass.uniforms.uNear!.value = c.near
    pass.uniforms.uFar!.value = c.far
    pass.uniforms.uOrtho!.value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0
    composer.render()
  }
  const dispose = () => { normalTarget.dispose(); normalTarget.depthTexture?.dispose(); building.dispose(); ground.dispose(); composer.dispose() }
  return { render, setSize, dispose }
}

export default function Ink({ background }: { background: string }) {
  const { gl, scene, camera, size, viewport } = useThree()
  const ink = useMemo(() => createInk(gl, scene, camera), [gl, scene]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ink.dispose(), [ink])
  useEffect(() => { ink.setSize(size.width, size.height, viewport.dpr) }, [ink, size.width, size.height, viewport.dpr])
  // The page colour as the scene's background, so the beauty pass clears to it (the normal pass clears to nothing).
  useEffect(() => { const prev = scene.background; scene.background = new THREE.Color(background); return () => { scene.background = prev } }, [scene, background])
  useFrame((state) => ink.render(state.camera), 1)
  return null
}
