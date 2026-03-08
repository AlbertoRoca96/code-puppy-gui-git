# Code Puppy - Full Stack Setup Guide 🐶

Your repo now has **4 components** for 24/7 accessibility:

1. **Desktop App** - Python Tkinter GUI
2. **Web App** - React on GitHub Pages
3. **API Backend** - FastAPI on Fly.io
4. **Mobile App** - Expo iOS/Android (NEW!)

---

## 📱 Mobile App Quick Start (New!)

### Prerequisites
- Node.js 20+
- Expo CLI: `npm install -g expo-cli`
- Mac with Xcode (for iOS builds)

### Local Development

```bash
cd mobile
npm install
npm start          # Press 'i' for iOS simulator
```

### Production Setup (One-time)

```bash
# Login to Expo
npm install -g eas-cli
eas login

# Configure EAS
cd mobile
eas build:configure
npx expo install expo-router react-native-safe-area-context

# Add app icons
# Add icon.png and adaptive-icon.png to mobile/assets/
# (See mobile/assets/README.md)
```

### Build for TestFlight

```bash
cd mobile
eas build --platform ios --profile preview
```

### GitHub Secrets

Add to your GitHub repo settings:

| Secret | Purpose | Required |
|--------|---------|----------|
| `FLY_API_TOKEN` | Fly.io deployment | ✅ |
| `SYN_API_KEY` | Synthetic AI key | ✅ |
| `EXPO_TOKEN` | Expo builds | ✅ (new for mobile) |

---

## 🌐 Full Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                   GitHub Repo                        │
│  code-puppy-gui-git                                   │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Desktop App  │  │  Web App     │  │ Mobile App │ │
│  │ (Python)     │  │  (React)     │  │ (Expo/RN)  │ │
│  │ src/code_pup │  │  docs/       │  │ mobile/    │ │
│  │ _py_gui/     │  │              │  │            │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────┘ │
│         │                 │                │        │
│         └─────────────────┴────────────────┘        │
│                          │                           │
│                          ▼                           │
│              ┌───────────────────────┐              │
│              │   FastAPI Backend     │              │
│              │   backend/app.py      │              │
│              │   Fly.io              │              │
│              │   code-puppy-api.fly. │              │
│              │   dev                 │              │
│              └───────────┬───────────┘              │
│                          │                           │
│                          ▼                           │
│              ┌───────────────────────┐              │
│              │   AI Models           │              │
│              │   HuggingFace,        │              │
│              │   OpenAI, etc.        │              │
│              └───────────────────────┘              │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 GitHub Actions Workflows

### 1. Backend Deployment (`deploy-backend.yml`)
- Runs on push to `main`
- Deploys FastAPI to Fly.io
- Sets secrets automatically

### 2. Mobile Builds (`mobile-build.yml`)
- Runs on push to `main` (when `mobile/` changes)
- Builds iOS TestFlight via EAS
- Builds Android APK

### 3. Web Deployment
- GitHub Pages auto-deploys from `docs/`
- Trigger on push to `main`

---

## 🔧 What Works Now

### Desktop
```bash
pip install -e .
code-puppy-gui
```

### Web
Just visit: https://albertoroca96.github.io/code-puppy-gui-git/

### API Backend
Running at: https://code-puppy-api.fly.dev

### Mobile (NEW!)
```bash
cd mobile
npm start  # Start dev server
# Add assets/icons
# Build and deploy to TestFlight
```

---

## 📝 Next Steps

1. **Add app icons** - Create `icon.png` (1024x1024) and `adaptive-icon.png` in `mobile/assets/`

2. **Test mobile locally**:
   ```bash
   cd mobile
   npm install
   npm start
   # Try the app in iOS simulator
   ```

3. **Configure EAS** (first time only):
   ```bash
   eas login
   cd mobile
   eas build:configure
   ```

4. **Add EXPO_TOKEN secret**:
   - Get token from: https://expo.dev/settings/access-tokens
   - Add to GitHub repo settings → Secrets

5. **Build for TestFlight**:
   ```bash
   cd mobile
   eas build --platform ios --profile preview
   ```

6. **Push to trigger builds**:
   ```bash
   git add mobile/
   git commit -m "Add mobile app"
   git push origin main
   ```
   This will:
   - Deploy backend to Fly.io ✓
   - Build mobile app for TestFlight ✓
   - Deploy web to GitHub Pages ✓

---

## 🌟 All Four Deployments

| Platform | URL | Status |
|----------|-----|--------|
| Desktop | Local install only | ✅ Works |
| Web | https://albertoroca96.github.io/code-puppy-gui-git/ | ✅ GitHub Pages |
| API Backend | https://code-puppy-api.fly.dev | ✅ Fly.io |
| Mobile iOS | TestFlight (via EAS) | 🔄 Ready to build |
| Mobile Android | APK (via EAS) | 🔄 Ready to build |

All sharing the **same FastAPI backend** for consistent AI responses!

---

## 📚 Documentation

- `mobile/README.md` - Mobile app documentation
- `README.md` - Main repo documentation
- `CODE_PUPPY_EXPO_GUIDE.md` (in Projects/) - Full Expo guide
- `EXPO_STRUCTURE_COMPARISON.md` (in Projects/) - Comparison with retail-inventory-tracker

---

## 🔗 Links

- **GitHub Repo**: https://github.com/AlbertoRoca96/code-puppy-gui-git
- **Live Web App**: https://albertoroca96.github.io/code-puppy-gui-git/
- **API Backend**: https://code-puppy-api.fly.dev

---

Go make it accessible from anywhere! Your code puppy is now always online! 🐶🚀
