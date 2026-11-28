// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// PRNT "AI 보정" 옵션: 학습된 소형 U-Net(public/ml/prnt-plaque-model/, 118K 파라미터, ~480KB)으로
// 픽셀별 플라크 확률맵을 뽑아 기존 detectBlobs()가 쓰는 "채널"(0~255) 형태로 돌려준다.
// TensorFlow.js는 CDN을 쓰지 않고 public/vendor/tfjs(-backend-wasm)/에 내려받아 둔 사본을 쓴다.
// GPU가 약한 안드로이드·사무용 PC에서도 돌아가야 해서 WASM 백엔드를 쓴다(스레드형 WASM은 COOP/COEP 헤더가
// 필요해 Firebase Hosting 설정과 안 맞아 뺐다 — public/vendor/tfjs-backend-wasm/에 단일 스레드용만 있음).

let tfReadyPromise = null;
let modelPromise = null;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureTf() {
  if (!tfReadyPromise) {
    tfReadyPromise = (async () => {
      if (typeof window.tf === 'undefined') await loadScriptOnce('./vendor/tfjs/tf.min.js');
      if (typeof window.tf.wasm === 'undefined') await loadScriptOnce('./vendor/tfjs-backend-wasm/tf-backend-wasm.min.js');
      window.tf.wasm.setWasmPaths('./vendor/tfjs-backend-wasm/');
      await window.tf.setBackend('wasm');
    })();
  }
  return tfReadyPromise;
}

async function ensureModel() {
  await ensureTf();
  if (!modelPromise) modelPromise = window.tf.loadLayersModel('./ml/prnt-plaque-model/model.json');
  return modelPromise;
}

// 미리 불러만 둬서(모델 사용 버튼을 누르기 전에) 실제 분석 때 대기 시간을 줄인다. 실패해도 조용히 무시.
export function preloadPlaqueModel() {
  ensureModel().catch(() => {});
}

// pixels: RGBA Uint8ClampedArray(toChannel과 같은 형식), w/h: 분석 해상도.
// 반환: Float32Array(w*h), 0~255 스케일의 "확률 채널" — detectBlobs(channel, w, h, well, threshold, opts)에 그대로 넣을 수 있다.
export async function runPlaqueProbability(pixels, w, h) {
  const tf = window.tf;
  const model = await ensureModel();
  const PAD = 4; // U-Net 다운샘플 2번(깊이 3) → 높이·너비가 4의 배수가 아니면 skip-connection 크기가 안 맞는다.
  const ph = (PAD - (h % PAD)) % PAD, pw = (PAD - (w % PAD)) % PAD;

  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = pixels[i * 4] / 255;
    rgb[i * 3 + 1] = pixels[i * 4 + 1] / 255;
    rgb[i * 3 + 2] = pixels[i * 4 + 2] / 255;
  }

  const out = tf.tidy(() => {
    let t = tf.tensor3d(rgb, [h, w, 3]);
    if (ph || pw) t = tf.mirrorPad(t, [[0, ph], [0, pw], [0, 0]], 'reflect');
    const batched = t.expandDims(0);
    const pred = model.predict(batched); // [1, h+ph, w+pw, 1], 0~1 시그모이드
    return pred.slice([0, 0, 0, 0], [1, h, w, 1]).reshape([h, w]);
  });
  const probs = await out.data();
  out.dispose();

  const channel = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) channel[i] = probs[i] * 255;
  return channel;
}
