// Pixel Pal cloud layer: Google sign-in + private per-account storage (Firebase).
// If firebase-config.js has not been filled in, the game simply runs in device-only mode.
(async () => {
  const cfg = window.FIREBASE_CONFIG;
  const announce = () => window.dispatchEvent(new Event('pp-cloud'));

  if (!cfg || !cfg.apiKey || /PASTE/i.test(cfg.apiKey)) {
    window.PPCloud = { configured: false };
    announce();
    return;
  }

  const V = '10.12.2';
  const base = 'https://www.gstatic.com/firebasejs/' + V + '/';
  const load = window.__PP_LOADER || ((u) => import(u));
  let A, F, auth, db;
  try {
    const [App, Auth, Fs] = await Promise.all([
      load(base + 'firebase-app.js'),
      load(base + 'firebase-auth.js'),
      load(base + 'firebase-firestore.js'),
    ]);
    A = Auth; F = Fs;
    const app = App.initializeApp(cfg);
    auth = A.getAuth(app);
    db = F.getFirestore(app);
  } catch (e) {
    console.warn('Cloud unavailable', e);
    window.PPCloud = { configured: false, error: String(e) };
    announce();
    return;
  }

  let current = null, known = false;
  const listeners = new Set();
  const uid = () => { if (!current) throw new Error('not signed in'); return current.uid; };

  A.onAuthStateChanged(auth, (u) => {
    current = u; known = true;
    if (u) {
      // keep a small profile record for the account (name + email only)
      F.setDoc(F.doc(db, 'users', u.uid),
        { name: u.displayName || '', email: u.email || '', lastLogin: F.serverTimestamp() },
        { merge: true }).catch(() => {});
    }
    listeners.forEach((f) => { try { f(u); } catch (e) { console.error(e); } });
  });
  A.getRedirectResult(auth).catch(() => {});

  window.PPCloud = {
    configured: true,
    onAuth(f) { listeners.add(f); if (known) f(current); },

    async signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' }); // lets people pick or switch Google accounts
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (e && e.code === 'auth/popup-blocked') return A.signInWithRedirect(auth, provider);
        throw e;
      }
    },
    signOut() { return A.signOut(auth); },

    // ---- everything below lives under users/{uid}/ and is readable only by that user ----
    async pull() {
      const id = uid();
      const [pr, cu, gr] = await Promise.all([
        F.getDocs(F.collection(db, 'users', id, 'progress')),
        F.getDocs(F.collection(db, 'users', id, 'custom')),
        F.getDoc(F.doc(db, 'users', id, 'meta', 'groups')),
      ]);
      const progress = {};
      pr.forEach((d) => { const v = d.data(); if (v && typeof v.p === 'string') progress[d.id] = v.p; });
      const custom = [];
      cu.forEach((d) => {
        const v = d.data();
        if (v && v.cells) custom.push({ id: d.id, name: v.name, w: v.w, h: v.h, palette: v.palette, cells: v.cells });
      });
      let groups = { list: [], map: {} };
      if (gr.exists()) {
        const v = gr.data();
        if (v && typeof v.json === 'string') { try { groups = JSON.parse(v.json); } catch (e) {} }
      }
      return { progress, custom, groups };
    },
    pushProgress(pid, p) {
      return F.setDoc(F.doc(db, 'users', uid(), 'progress', pid), { p, updatedAt: F.serverTimestamp() });
    },
    deleteProgress(pid) {
      return F.deleteDoc(F.doc(db, 'users', uid(), 'progress', pid));
    },
    pushCustom(c) {
      return F.setDoc(F.doc(db, 'users', uid(), 'custom', c.id),
        { name: c.name, w: c.w, h: c.h, palette: c.palette, cells: c.cells, createdAt: F.serverTimestamp() });
    },
    deleteCustom(pid) {
      return F.deleteDoc(F.doc(db, 'users', uid(), 'custom', pid));
    },
    pushGroups(g) {
      return F.setDoc(F.doc(db, 'users', uid(), 'meta', 'groups'),
        { json: JSON.stringify(g), updatedAt: F.serverTimestamp() });
    },
  };
  announce();
})();
