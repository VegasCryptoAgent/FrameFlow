/**
 * Extracts frames from a video URL at specified intervals.
 * Implements resilient decoding with retry logic and seek watchdogs to handle long videos.
 */
export const extractFramesFromVideo = async (
  videoUrl: string,
  intervalSeconds: number,
  onProgress: (progress: number) => void
): Promise<{ timestamp: number; imageUrl: string }[]> => {
  return new Promise((resolve, reject) => {
    let video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const frames: { timestamp: number; imageUrl: string }[] = [];
    
    // Recovery & Loop state
    let currentTime = 0;
    let isFinished = false;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    let lastSuccessfulTime = 0;
    let seekTimeout: number | null = null;

    // Decoding constraints
    const MAX_DIM = 1280;
    const SEEK_DELAY = 150; // Reduced for speed, watchdog handles hangs
    const WATCHDOG_MS = 5000; // 5 seconds to finish a seek

    const clearWatchdog = () => {
      if (seekTimeout) {
        window.clearTimeout(seekTimeout);
        seekTimeout = null;
      }
    };

    const startWatchdog = () => {
      clearWatchdog();
      seekTimeout = window.setTimeout(() => {
        if (isFinished) return;
        console.warn(`Seek watchdog triggered at ${currentTime}s. Recovering...`);
        // Attempt to recover by re-initializing the video element
        setupVideo(currentTime);
      }, WATCHDOG_MS);
    };

    const setupVideo = (startTime: number) => {
      if (video.parentNode) video.parentNode.removeChild(video);
      clearWatchdog();
      
      video = document.createElement('video');
      // Keep visible but tiny to prevent browser from suspending background video
      video.style.position = 'fixed';
      video.style.bottom = '0';
      video.style.right = '0';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0.01'; 
      video.style.pointerEvents = 'none';
      video.style.zIndex = '-1';
      
      video.setAttribute('muted', 'true');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('preload', 'auto');
      document.body.appendChild(video);

      if (!videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) {
        video.crossOrigin = 'anonymous';
      }

      video.src = videoUrl;
      video.muted = true;
      video.volume = 0;

      const onMetadata = () => {
        // Some browsers report Infinity initially for duration
        if (!isFinite(video.duration) || video.duration === 0) {
          // Wait for progress event to get real duration
          video.addEventListener('progress', onMetadata, { once: true });
          return;
        }

        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = (MAX_DIM / width) * height;
            width = MAX_DIM;
          } else {
            width = (MAX_DIM / height) * width;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        
        // Ensure we start from where we left off if this is a recovery
        currentTime = startTime;
        seekAndCapture();
      };

      // Safety timeout for metadata loading
      const metadataTimeout = setTimeout(() => {
        if (video.readyState < 1) {
          cleanup();
          reject(new Error("Video metadata loading timed out. The video format might be unsupported or the network is too slow."));
        }
      }, 15000);

      video.onloadedmetadata = () => {
        clearTimeout(metadataTimeout);
        onMetadata();
      };

      video.onseeked = () => {
        if (isFinished) return;
        clearWatchdog();
        
        // Ensure video is ready to be drawn (HAVE_CURRENT_DATA or better)
        if (video.readyState < 2) {
          startWatchdog();
          return;
        }

        if (context) {
          try {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            frames.push({
              timestamp: currentTime,
              imageUrl
            });

            lastSuccessfulTime = currentTime;
            currentTime += intervalSeconds;
            
            setTimeout(() => {
                seekAndCapture();
            }, SEEK_DELAY);

          } catch (e) {
            console.error("Canvas draw error:", e);
            handleError(new Error("Video frame processing interrupted."));
          }
        }
      };

      video.onerror = () => {
        const error = video.error;
        // Decoder crash or resource issue
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.warn(`Video error (Code ${error?.code}). Retry ${retryCount}/${MAX_RETRIES} at ${currentTime}s...`);
          setupVideo(lastSuccessfulTime);
        } else {
          let errorMessage = error?.message || "Critical video decoding failure.";
          if (error && !error.message) {
            switch (error.code) {
              case 1: errorMessage = "Video loading aborted."; break;
              case 2: errorMessage = "Network error while loading video."; break;
              case 3: errorMessage = "Video decoding failed. The video might be corrupted or unsupported."; break;
              case 4: errorMessage = videoUrl.includes('/api/video-proxy')
                ? "The proxied stream was not a browser-playable MP4. Paste a direct .mp4 or .webm URL instead."
                : "Video format not supported, or the host blocked the request. Direct .mp4/.webm links work best."; break;
            }
          }
          handleError(new Error(errorMessage));
        }
      };
    };

    const seekAndCapture = () => {
      if (isFinished) return;
      
      // Critical check: ensure we actually have a duration to compare against
      if (!isFinite(video.duration)) {
        startWatchdog(); // If duration is missing, watchdog will eventually re-trigger setup
        return;
      }

      if (currentTime >= video.duration) {
        onProgress(100);
        cleanup();
        resolve(frames);
        return;
      }

      onProgress(Math.min(99, Math.round((currentTime / video.duration) * 100)));
      
      startWatchdog();
      video.currentTime = currentTime;
    };

    const handleError = (err: Error) => {
      if (frames.length > 0) {
        console.warn(`Analysis partial: ${frames.length} frames extracted before failure: ${err.message}`);
        cleanup();
        resolve(frames);
      } else {
        cleanup();
        reject(err);
      }
    };

    const cleanup = () => {
      isFinished = true;
      clearWatchdog();
      video.onerror = null;
      video.onseeked = null;
      video.onloadedmetadata = null;
      video.pause();
      video.src = "";
      video.load();
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    };
    
    // Initial setup
    setupVideo(0);
  });
};