# Code Puppy Mobile App 🐶

iOS/Android app for Code Puppy - your sassy AI coding assistant!

## 📱 Development

```bash
npm install
npm start          # Start Expo dev server (press 'i' for iOS, 'a' for Android)
npm run ios        # Run on iOS simulator
npm run android    # Run on Android emulator
```

## 🚀 Building for Production

### Setup EAS (first time)
```bash
npm install -g eas-cli
eas login
eas build:configure
```

### Build iOS
```bash
eas build --platform ios --profile production
```

### Build Android
```bash
eas build --platform android --profile production
```

### Submit to App Store/TestFlight
```bash
eas submit --platform ios --profile production
```

## 🔧 Configuration

- `app.config.ts` - Expo configuration
- `eas.json` - Build profiles
- `package.json` - Dependencies and scripts
- `src/hooks/useChat.ts` - Chat state management
- `src/lib/` - API integration (TODO: connect to FastAPI backend)

## 📁 Structure

```
mobile/
├── app/                # Expo Router screens
│   ├── _layout.tsx     # Root layout
│   ├── index.tsx       # Main chat screen
│   ├── settings.tsx    # Settings page
│   └── about.tsx       # About page
├── src/
│   ├── components/     # Reusable components (TODO)
│   ├── hooks/          # React hooks
│   └── lib/            # Utilities & API clients (TODO)
└── assets/             # Images and icons (add icon.png)
```

## 🌐 Backend Integration

This mobile app connects to the FastAPI backend:
- Local dev: `http://localhost:8000/api/chat`
- Production: `https://code-puppy-api.fly.dev/api/chat`

The API client will be in `src/lib/api.ts` (TODO).

## 📝 TODO

- [ ] Add icon.png and adaptive-icon.png to assets/
- [ ] Create PromptInput component
- [ ] Create ResponseDisplay component  
- [ ] Implement proper API client in src/lib/api.ts
- [ ] Add proper chat message UI
- [ ] Configure EAS project ID
- [ ] Test on real iOS device
- [ ] Set up TestFlight distribution

## 🔗 Links

- GitHub Pages (Web): https://albertoroca96.github.io/code-puppy-gui-git
- API Backend: https://code-puppy-api.fly.dev
- GitHub Repo: https://github.com/AlbertoRoca96/code-puppy-gui-git

---

Ready to code! 🐶🚀
