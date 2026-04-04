import { AddOn } from '@busch-jaeger/free-at-home';
import { WebhookBridge } from './webhookBridge';

const metaData = AddOn.readMetaData();
const addOn = new AddOn.AddOn(metaData.id);
const bridge = new WebhookBridge();

addOn.on('configurationChanged', (configuration: AddOn.Configuration) => {
  console.log('Configuration changed – reconnecting to SysAP...');
  bridge.connect(configuration);
});

addOn.connectToConfiguration();
