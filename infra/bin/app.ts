#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ViaticosStack } from '../lib/viaticos-stack.js';
import { AWS_REGION, DOMAIN } from '@viaticos/shared';

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? '571170832142';
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? AWS_REGION;

new ViaticosStack(app, 'ViaticosStack', {
  env: {
    account,
    region,
  },
  domainName: DOMAIN,
});

app.synth();
