// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// Firebase 초기화 (웹 apiKey는 공개 식별자이며 접근 제어는 Security Rules로 한다)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyDosiPaYwdJdqZ7_h93lQxvR949m7WqPqk',
  authDomain: 'wwpcr-e6fdf.firebaseapp.com',
  projectId: 'wwpcr-e6fdf',
  storageBucket: 'wwpcr-e6fdf.firebasestorage.app',
  messagingSenderId: '236177878194',
  appId: '1:236177878194:web:0b29511b22f6cc7c92edab',
  measurementId: 'G-6G5F734V1C',
};

export const app = initializeApp(firebaseConfig);
isSupported().then((ok) => ok && getAnalytics(app)).catch(() => {});
