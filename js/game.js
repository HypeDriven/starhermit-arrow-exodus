/* Arrow Exodus — game controller: wires rules, content, audio, rendering,
 * persistence into the DOM UI. Browser-only (window.AXGame). */
import * as THREE from '../vendor/three.module.min.js';
import { createRenderer, webglAvailable } from './render3d.js';

const AXAudio = window.AXAudio;
const AXRules = window.AXRules;
const AXContent = window.AXContent;
const AXStore = window.AXStore;
const AXRNG = window.AXRNG;

// ---------- module-level state ----------
let renderer3d = null;      // three.js render handle (createRenderer result) or null if unavailable
let webglOk = false;        // whether WebGL is available on this device
let currentScreen = 'title';
let playCtx = null;         // { kind, levelId?, lessonIdx? } for the active round

// ---------- helpers ----------
function $(id){ return document.getElementById(id); }
function el(tag, cls, txt){ const e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e; }

export default {
  $: $, el: el,
  get webglOk(){ return webglOk; },
};
