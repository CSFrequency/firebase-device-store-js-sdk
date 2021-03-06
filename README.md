# Firebase Device Store (Javascript SDK)

Automatically store Device and FCM Token information for Firebase Auth Users in Cloud Firestore.

[![npm version](https://img.shields.io/npm/v/firebase-device-store.svg?style=flat-square)](https://www.npmjs.com/package/firebase-device-store)
[![npm downloads](https://img.shields.io/npm/dm/firebase-device-store.svg?style=flat-square)](https://www.npmjs.com/package/firebase-device-store)

> This library is a proof of concept, and very much a work in progress.

## Installation

Firebase Device Store requires **Firebase v5.0.0 or later**.

```
npm install --save firebase-device-store
```

## Setup

The following Firebase libraries need to be enabled in your application:

```
import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import 'firebase/messaging';
```

## Example usage

```
import createDeviceStore from 'firebase-device-store';

const deviceStore = createDeviceStore(firebase.app(), 'user-devices');
await deviceStore.subscribe();
```

## Documentation

Firebase Device Store automatically stores device and FCM information for Firebase Auth users in Cloud Firestore.

### Data Model

A Document is created in the Cloud Firestore collection for each logged in user:

```
/user-devices
  - userId1: {},
  - userId2: {},
```

The structure of this Document is as follows:

```
{
  devices: {
    deviceId1: Device,
    deviceId2: Device,
    ...
  },
  userId: string,
}
```

A `Device` object contains the following:

```
{
  deviceId: string, // A randomly generated ID
  fcmToken: string, // The FCM token
  name: string,     // The browser name
  os: string,       // The OS of the device
  type: 'Web',
  userAgent: string // The browser user agent string
}
```

### API

#### `createDeviceStore(app, collectionPath)`

Create a new DeviceStore.

Parameters:

- `app`: `firebase.app.App` for the Firebase App to use
- `collectionPath`: (Optional) `string` to specify the Cloud Firestore collection where devices should be stored. Defaults to `user-devices`.

Returns a `DeviceStore`.

#### `DeviceStore.signOut(): Promise<void>`

Indicate to the DeviceStore that the user is about to sign out, and the current device token should be removed.

This can't be done automatically with `onAuthStateChanged` as the user is already signed out at this point. This means the Cloud Firestore security rules will prevent the database deletion as they no longer have the correct user permissions to remove the token.

#### `DeviceStore.subscribe(): Promise<void>`

Subscribe a device store to the Firebase App. This will:

1. Request appropriate Firebase Cloud Messaging permissions, if they have not already been granted
2. Subscribe to Firebase Auth and listen to changes in authentication state
3. Subscribe to Firebase Cloud Messaging and listen to changes in the FCM token
4. Automatically store device and FCM token information in the Cloud Firestore collection you specify

#### `DeviceStore.unsubscribe(): void`

Unsubscribe the device store from the Firebase App.

### Security rules

You will need to add the following security rules for your Cloud Firestore collection:

```
service cloud.firestore {
  match /databases/{database}/documents {
    // Add this rule, replacing `user-devices` with the collection path you would like to use:
    match /user-devices/{userId} {
      allow create, read, update, delete: if request.auth.uid == userId;
    }
  }
}
```
