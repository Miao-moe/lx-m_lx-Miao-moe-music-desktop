import { installGlobalVisualizerFrameRateLimiter } from '../vendor/src/utils/frameRateLimiter'

// Motion captures requestAnimationFrame while its module is being evaluated.
// Install the shared 60 FPS clock before importing any animation libraries.
installGlobalVisualizerFrameRateLimiter(60)
