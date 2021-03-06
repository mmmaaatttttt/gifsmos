/*
 * Action creators
 *
 * Actions are plain objects containing the information necessary to update the
 * application state held in the store. They must contain a `type` property,
 * and any additional data must be contained within its `payload` object.
 *
 * Action creators are simply functions that return actions. This small extra
 * bit of abstraction seems weird but has some benefits: primarily, action
 * creators can be passed to components as props so that components never need
 * to explicitly call `dispatch`. That makes component testing and reuse
 * simpler.
 *
 * By default, the store only supports synchronous data flow, but we need to
 * handle asynchronous updates in a few places, like fetching image data from
 * the calculator and generating the final GIF. There is some middleware in
 * place that allows us to write action creators that return a function (called
 * a "thunk") instead of an action. Thunks receive the store's `dispatch`
 * method as an argument and are allowed to have side effects, which gives us
 * the flexibility we need to make async calls to the Desmos and gifshot APIs
 * before updating the store.
 *
 * Because they can access the store, dispatch multiple actions, and produce
 * arbitrary side effects, thunks should be used with care. We should prefer
 * regular, synchronous action creators unless we need an asynchronous update,
 * which makes a thunk mandatory.
 */

import * as types from '../constants/action-types';
import { setSliderByIndex, getImageData } from '../lib/calc-helpers';
import { startTimer, clearTimer } from '../lib/timer';
import {
  gifCreationProblem,
  badBurstInput,
  badSettingsInput
} from '../lib/error-messages';
import { getBurstErrors, getSettingsErrors } from '../lib/input-helpers';

const ERROR_DELAY = 3000;
let nextFrameID = 0;
let errorTimeout;

export const addFrame = imageData => ({
  type: types.ADD_FRAME,
  payload: {
    id: ++nextFrameID,
    imageData
  }
});

export const updateGIFProgress = progress => ({
  type: types.UPDATE_GIF_PROGRESS,
  payload: { progress }
});

export const addGIF = imageData => ({
  type: types.ADD_GIF,
  payload: { imageData }
});

export const togglePane = pane => {
  clearTimer();
  return {
    type: types.TOGGLE_PANE,
    payload: { pane }
  };
};

export const updatePreviewIdx = idx => ({
  type: types.UPDATE_PREVIEW_IDX,
  payload: { idx }
});

export const updateSetting = (setting, val) => {
  let type;
  const payload = { [setting]: val };

  switch (setting) {
    case 'width':
    case 'height':
    case 'interval':
    case 'oversample':
      type = types.UPDATE_IMAGE_SETTING;
      break;

    case 'left':
    case 'right':
    case 'top':
    case 'bottom':
      type = types.UPDATE_BOUNDS_SETTING;
      break;

    default:
      type = types.UPDATE_STRATEGY;
  }

  return {
    type,
    payload
  };
};

export const playPreview = () => ({ type: types.PLAY_PREVIEW });

export const stopAnimation = () => {
  clearTimer();
  return { type: types.PAUSE_PREVIEW };
};

export const setError = message => ({
  type: types.SET_ERROR,
  payload: { message }
});

export const clearError = () => ({ type: types.CLEAR_ERROR });

export const reset = () => {
  clearTimer();
  return { type: types.RESET };
};

// Thunks
export const flashError = message => dispatch => {
  clearTimeout(errorTimeout);
  dispatch(setError(message));
  errorTimeout = setTimeout(() => dispatch(clearError()), ERROR_DELAY);
};

export const requestFrame = opts => async dispatch => {
  const { width, height } = opts;

  const settingsErrors = getSettingsErrors({ width, height });
  if (Object.keys(settingsErrors).length) {
    dispatch(flashError(badSettingsInput(settingsErrors)));
    return;
  }

  const imageData = await getImageData(opts);
  dispatch(addFrame(imageData));
};

export const requestBurst = opts => async (dispatch, getState) => {
  const { idx, min, max, step, width, height, oversample } = opts;
  const imageOpts = {
    width,
    height,
    targetPixelRatio: oversample ? 2 : 1
  };

  // Check for errors in the current pane first.
  const burstErrors = getBurstErrors({ idx, min, max, step });
  if (Object.keys(burstErrors).length) {
    dispatch(flashError(badBurstInput(burstErrors)));
    return;
  }

  // Then check for errors in the settings pane.
  const settingsErrors = getSettingsErrors({ width, height });
  if (Object.keys(settingsErrors).length) {
    dispatch(flashError(badSettingsInput(settingsErrors)));
    return;
  }

  let imageData;
  let sliderErrorMessage;
  for (let val = min; val <= max; val += step) {
    sliderErrorMessage = setSliderByIndex(idx, val);
    if (sliderErrorMessage) {
      dispatch(flashError(sliderErrorMessage));
      return;
    }

    imageData = await getImageData(imageOpts);
    dispatch(addFrame(imageData));
  }
};

export const startAnimation = () => (dispatch, getState) => {
  dispatch(playPreview());
  const step = () => {
    const state = getState();
    const frameIDs = state.images.frameIDs;
    const numFrames = frameIDs.length;
    const previewIdx = state.ui.previewIdx;
    const nextFrameIdx = previewIdx === numFrames - 1 ? 0 : previewIdx + 1;
    dispatch(updatePreviewIdx(nextFrameIdx));
  };
  const {
    settings: {
      image: { interval }
    }
  } = getState();
  startTimer(step, interval);
};

// The gifshot library is loaded in index.html
const gifshot = window.gifshot;
export const generateGIF = (images, opts) => (dispatch, getState) => {
  // Have to check state interval and not opts because opts is in seconds
  const { interval } = getState().settings.image;
  const settingsErrors = getSettingsErrors({ interval });
  if (Object.keys(settingsErrors).length) {
    dispatch(flashError(badSettingsInput(settingsErrors)));
    return;
  }

  const gifshotArgs = {
    images,
    ...opts,
    progressCallback: progress => dispatch(updateGIFProgress(progress))
  };
  gifshot.createGIF(gifshotArgs, data => {
    if (data.error) {
      dispatch(flashError(gifCreationProblem()));
    } else {
      dispatch(addGIF(data.image));
    }
  });
};
