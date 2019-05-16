import { detect } from 'detect-browser';
import * as firebase from 'firebase';

type Device = {
  deviceId: string;
  fcmToken: string;
  name: string;
  os: string;
  type: 'Android' | 'iOS' | 'Web';
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
      const devices: Device[] = doc.data().devices || [];
      // Add the new device if it doesn't already exist
      if (!devices.find(device => device.fcmToken === token)) {
        devices.push(createDevice(token));
      }
      // Update the document
      return transaction.update(docRef, {
        devices,
      });
    } else {
      return transaction.set(docRef, {
        devices: [createDevice(token)],
        userId,
      });
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
      const devices: Device[] = doc.data().devices || [];
      // Remove the old device
      const updatedDevices = devices.filter(
        device => device.fcmToken !== token
      );
      // Update the document
      return transaction.update(docRef, {
        devices: updatedDevices,
      });
    } else {
      return transaction.set(docRef, {
        devices: [],
        userId,
      });
    }
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
      const devices: Device[] = doc.data().devices || [];
      let updatedDevices = devices;
      // Remove the old device
      if (oldToken) {
        updatedDevices = devices.filter(device => device.fcmToken !== oldToken);
      }
      // Add the new device if it doesn't already exist
      if (newToken) {
        if (!updatedDevices.find(device => device.fcmToken === newToken)) {
          updatedDevices.push(createDevice(newToken));
        }
      }
      // Update the document
      return transaction.update(docRef, {
        devices: updatedDevices,
      });
    } else if (newToken) {
      return transaction.set(docRef, {
        devices: [createDevice(newToken)],
        userId,
      });
    } else {
      return transaction.set(docRef, {
        devices: [],
        userId,
      });
    }
  });
};

const createDevice = (fcmToken: string): Device => {
  const browser = detect();
  return {
    deviceId: window.navigator.userAgent,
    fcmToken,
    name: browser.name.charAt(0).toUpperCase() + browser.name.slice(1),
    os: browser.os,
    type: 'Web',
  };
};

const userRef = (
  firestore: firebase.firestore.Firestore,
  collectionPath: string,
  userId: string
): firebase.firestore.DocumentReference => {
  return firestore.collection(collectionPath).doc(userId);
};
