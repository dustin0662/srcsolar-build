// Native camera for image uploads.
//
// The portal has several <input type="file" accept="image/*"> pickers
// (onboarding SSN/ID photos, Task Tracker site photo, proposal photos,
// employee-form photos, Screening Solutions profile pic). Rather than edit
// each one, the shell intercepts the click on any image file input, offers
// Camera / Photos through @capacitor/camera, and feeds the result back into
// the same input so the existing onChange handlers run unchanged.
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { isNative } from './platform.js'

const isImageInput = (el) =>
  el && el.tagName === 'INPUT' && el.type === 'file' && /image\//i.test(el.getAttribute('accept') || '')

async function dataUrlToFile(dataUrl, name) {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type || 'image/jpeg' })
}

/* Open the native picker and return a File, or null if cancelled. */
export async function pickImage(opts = {}) {
  const photo = await Camera.getPhoto({
    resultType: CameraResultType.DataUrl,
    source: opts.source || CameraSource.Prompt,   // Camera / Photos chooser
    quality: opts.quality || 82,
    width: opts.width || 2000,
    correctOrientation: true,
    promptLabelHeader: opts.title || 'Add photo',
    promptLabelPhoto: 'Choose from photos',
    promptLabelPicture: 'Take a photo',
  })
  if (!photo || !photo.dataUrl) return null
  const ext = (photo.format || 'jpeg').replace('jpg', 'jpeg')
  return dataUrlToFile(photo.dataUrl, 'photo-' + Date.now() + '.' + (ext === 'jpeg' ? 'jpg' : ext))
}

export function installCameraBridge() {
  if (!isNative) return
  document.addEventListener('click', (ev) => {
    const input = ev.target
    if (!isImageInput(input) || input.multiple) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    pickImage({ source: input.getAttribute('capture') != null ? CameraSource.Camera : CameraSource.Prompt })
      .then((file) => {
        if (!file) return
        const dt = new DataTransfer()
        dt.items.add(file)
        input.files = dt.files
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      .catch(() => { /* cancelled or permission denied — leave the input untouched */ })
  }, true)
}
