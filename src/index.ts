import { detect } from 'detect-browser';
import * as firebase from 'firebase';
import nanoid from 'nanoid';

type Device = {
  deviceId: string;
  fcmToken: string;
  name: string;
  os: string;
  type: 'Android' | 'iOS' | 'Web';
  userAgent?: string;
};

type Devices = { [deviceId: string]: Device };

type UserDevices = {
  devices: Devices;
  userId: string;
};

interface DeviceStore {
  signOut: () => Promise<void>;
  subscribe: () => Promise<void>;
  unsubscribe: firebase.Unsubscribe;
}

export default (
  app: firebase.app.App,
  collectionPath: string = 'user-devices'
): DeviceStore => {
  const auth = app.auth();
  let authSubscription: firebase.Unsubscribe | void;
  let currentToken: string | void;
  let currentUser: firebase.User | void;
  const firestore = app.firestore();
  const messaging = app.messaging();
  let subscribed = false;
  let tokenSubscription: firebase.Unsubscribe | void;

  const subscribe = async (): Promise<void> => {
    // Prevent duplicate subscriptions
    if (subscribed) {
      return Promise.resolve();
    }

    // This will throw an error if permissions have not been granted
    await messaging.requestPermission();

    subscribed = true;

    // Get the current token
    currentToken = await messaging.getToken();
    currentUser = auth.currentUser;

    if (currentToken && currentUser) {
      // Store the FCM token in Firestore
      await addToken(firestore, collectionPath, currentUser.uid, currentToken);
    }

    // Subscribe to authentication state
    authSubscription = auth.onAuthStateChanged(async user => {
      if (user && !currentUser && currentToken) {
        // Update the cached user
        currentUser = user;

        // Store the FCM token in Firestore
        await addToken(
          firestore,
          collectionPath,
          currentUser.uid,
          currentToken
        );
      } else if (!user && currentUser) {
        console.warn(
          'You need to call the `logout` method on the DeviceStore before logging out the user'
        );

        // Clear the cached user
        currentUser = user;
      }
    });

    // Subscribe to FCM token refreshes
    tokenSubscription = messaging.onTokenRefresh(async () => {
      const token = await messaging.getToken();
      // If the token has changed, then update it
      if (token !== currentToken && currentUser) {
        await updateToken(
          firestore,
          collectionPath,
          currentUser.uid,
          currentToken,
          token
        );
      }
      // Update the cached token
      currentToken = token;
    });
  };

  const unsubscribe = () => {
    if (subscribed) {
      if (authSubscription) {
        authSubscription();
      }
      if (tokenSubscription) {
        tokenSubscription();
      }
      // Reset state
      currentToken = undefined;
      currentUser = undefined;
      // Clear subscription flag
      subscribed = false;
    }
  };

  const signOut = async (): Promise<void> => {
    if (currentUser && currentToken) {
      await deleteToken(
        firestore,
        collectionPath,
        currentUser.uid,
        currentToken
      );
    }

    // Clear the cached user
    currentUser = undefined;
  };

  return {
    signOut,
    subscribe,
    unsubscribe,
  };
};

const addToken = (
  firestore: firebase.firestore.Firestore,
  collectionPath: string,
  userId: string,
  token: string
) => {
  const docRef = userRef(firestore, collectionPath, userId);

  return firestore.runTransaction(async transaction => {
    const doc = await transaction.get(docRef);

    if (doc.exists) {
      const devices = getDevices(doc);

      // Check if a device already matches the FCM token, or generate a new one
      const deviceId = findDeviceId(devices, token) || generateDeviceId();
      // Set the device information
      devices[deviceId] = createDevice(deviceId, token);
      // Update the document
      return transaction.update(docRef, {
        devices,
      });
    } else {
      const userDevices = createUserDevices(userId, token);
      return transaction.set(docRef, userDevices);
    }
  });
};

const deleteToken = (
  firestore: firebase.firestore.Firestore,
  collectionPath: string,
  userId: string,
  token: string
) => {
  const docRef = userRef(firestore, collectionPath, userId);

  return firestore.runTransaction(async transaction => {
    const doc = await transaction.get(docRef);

    if (doc.exists) {
      const devices = getDevices(doc);

      // Find the device that matches the FCM token
      const deviceId = findDeviceId(devices, token);

      // If there is a matching device, remove it and update the document
      if (deviceId) {
        delete devices[deviceId];
      }
      return transaction.update(docRef, 'devices', devices);
    }

    // Firestore requires that every document read in a transaction must also
    // be written
    return transaction.set(docRef, undefined);
  });
};

const updateToken = (
  firestore: firebase.firestore.Firestore,
  collectionPath: string,
  userId: string,
  oldToken: string | void,
  newToken: string | void
) => {
  const docRef = userRef(firestore, collectionPath, userId);

  return firestore.runTransaction(async transaction => {
    const doc = await transaction.get(docRef);

    if (doc.exists) {
      const devices = getDevices(doc);
      const updatedDevices: Devices = {
        ...devices,
      };

      // If an old token is specified, find the device that matches the token
      if (oldToken) {
        const deviceId = findDeviceId(devices, oldToken);
        // If there is a matching device, then remove it
        if (deviceId) {
          delete updatedDevices[deviceId];
        }
      }

      // If a new token is specified, then add the device
      if (newToken) {
        const deviceId = generateDeviceId();
        updatedDevices[deviceId] = createDevice(deviceId, newToken);
      }

      // Update the document
      return transaction.update(docRef, {
        devices: updatedDevices,
      });
    } else {
      const userDevices = createUserDevices(userId, newToken);
      return transaction.set(docRef, userDevices);
    }
  });
};

const createDevice = (deviceId: string, fcmToken: string): Device => {
  const browser = detect();
  return {
    deviceId,
    fcmToken,
    name: browser.name.charAt(0).toUpperCase() + browser.name.slice(1),
    os: browser.os,
    type: 'Web',
    userAgent: window.navigator.userAgent,
  };
};

const createUserDevices = (
  userId: string,
  fcmToken: string | void
): UserDevices => {
  const deviceId = generateDeviceId();
  return {
    devices: fcmToken
      ? {
          [deviceId]: createDevice(deviceId, fcmToken),
        }
      : {},
    userId,
  };
};

const findDeviceId = (devices: Devices, token: string): string | void => {
  return Object.keys(devices).find(deviceId => {
    const device = devices[deviceId];
    return device.fcmToken === token;
  });
};

const generateDeviceId = (): string => {
  return nanoid();
};

const getDevices = (doc: firebase.firestore.DocumentSnapshot): Devices => {
  return doc.data().devices || {};
};

const userRef = (
  firestore: firebase.firestore.Firestore,
  collectionPath: string,
  userId: string
): firebase.firestore.DocumentReference => {
  return firestore.collection(collectionPath).doc(userId);
};
