import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { DOMAIN, GSI_NAMES, SECRETS, TABLE_NAMES } from '@viaticos/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled to infra/dist/lib → repo root is ../../..
const repoRoot = path.join(__dirname, '../../..');

export interface ViaticosStackProps extends cdk.StackProps {
  domainName?: string;
}

export class ViaticosStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ViaticosStackProps = {}) {
    super(scope, id, props);

    const domainName = props.domainName ?? DOMAIN;
    cdk.Tags.of(this).add('Project', 'viaticos');
    cdk.Tags.of(this).add('Domain', domainName);

    const telegramSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TelegramBotToken',
      SECRETS.telegramBotToken,
    );
    const entraSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'EntraConfig',
      SECRETS.entraConfig,
    );
    const glpiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GlpiConfig',
      SECRETS.glpiConfig,
    );

    const webhookSecret = new secretsmanager.Secret(this, 'TelegramWebhookSecret', {
      secretName: 'viaticos/telegram-webhook-secret',
      description: 'Secret token for Telegram webhook validation',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const receiptsBucket = new s3.Bucket(this, 'ReceiptsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(730) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: [`https://${domainName}`, 'http://localhost:5173'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    const webBucket = new s3.Bucket(this, 'WebBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const techniciansTable = new dynamodb.Table(this, 'TechniciansTable', {
      tableName: TABLE_NAMES.technicians,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    techniciansTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.techniciansByTelegramUserId,
      partitionKey: { name: 'telegramUserId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    techniciansTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.techniciansByEntraOid,
      partitionKey: { name: 'entraOid', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    techniciansTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.techniciansByManagerId,
      partitionKey: { name: 'managerId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    techniciansTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.techniciansByLinkCode,
      partitionKey: { name: 'telegramLinkCode', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const clientsTable = new dynamodb.Table(this, 'ClientsTable', {
      tableName: TABLE_NAMES.clients,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const projectsTable = new dynamodb.Table(this, 'ProjectsTable', {
      tableName: TABLE_NAMES.projects,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    projectsTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.projectsByClientId,
      partitionKey: { name: 'clientId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const expensesTable = new dynamodb.Table(this, 'ExpensesTable', {
      tableName: TABLE_NAMES.expenses,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    expensesTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.expensesByStatus,
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'submittedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    expensesTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.expensesByTechnicianMonth,
      partitionKey: { name: 'technicianId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'submittedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const expenseMessagesTable = new dynamodb.Table(this, 'ExpenseMessagesTable', {
      tableName: TABLE_NAMES.expenseMessages,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    expenseMessagesTable.addGlobalSecondaryIndex({
      indexName: GSI_NAMES.expenseMessagesByExpenseId,
      partitionKey: { name: 'expenseId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const botSessionsTable = new dynamodb.Table(this, 'BotSessionsTable', {
      tableName: TABLE_NAMES.botSessions,
      partitionKey: { name: 'telegramUserId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const rolesTable = new dynamodb.Table(this, 'RolesTable', {
      tableName: TABLE_NAMES.roles,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const approvalChainsTable = new dynamodb.Table(this, 'ApprovalChainsTable', {
      tableName: TABLE_NAMES.approvalChains,
      partitionKey: { name: 'submitterRoleId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const settlementBatchesTable = new dynamodb.Table(this, 'SettlementBatchesTable', {
      tableName: TABLE_NAMES.settlementBatches,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const expenseMotivesTable = new dynamodb.Table(this, 'ExpenseMotivesTable', {
      tableName: TABLE_NAMES.expenseMotives,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const locationsTable = new dynamodb.Table(this, 'LocationsTable', {
      tableName: TABLE_NAMES.locations,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const commonEnv: Record<string, string> = {
      RECEIPTS_BUCKET: receiptsBucket.bucketName,
      TELEGRAM_SECRET_NAME: SECRETS.telegramBotToken,
      ENTRA_SECRET_NAME: SECRETS.entraConfig,
      GLPI_SECRET_NAME: SECRETS.glpiConfig,
      TELEGRAM_WEBHOOK_SECRET_ARN: webhookSecret.secretArn,
      BEDROCK_MODEL_ID: 'amazon.nova-micro-v1:0',
      NODE_OPTIONS: '--enable-source-maps',
    };

    const nodeBundling = {
      minify: true,
      sourceMap: true,
      target: 'node20',
      format: OutputFormat.ESM,
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      externalModules: [] as string[],
      metafile: true,
    };

    const botFn = new NodejsFunction(this, 'BotWebhookFn', {
      entry: path.join(repoRoot, 'packages/bot/src/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: commonEnv,
      bundling: nodeBundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });

    const apiFn = new NodejsFunction(this, 'AdminApiFn', {
      entry: path.join(repoRoot, 'packages/api/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(45),
      environment: commonEnv,
      bundling: nodeBundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });

    for (const fn of [botFn, apiFn]) {
      receiptsBucket.grantReadWrite(fn);
      telegramSecret.grantRead(fn);
      entraSecret.grantRead(fn);
      webhookSecret.grantRead(fn);
      techniciansTable.grantReadWriteData(fn);
      clientsTable.grantReadWriteData(fn);
      projectsTable.grantReadWriteData(fn);
      expensesTable.grantReadWriteData(fn);
      expenseMessagesTable.grantReadWriteData(fn);
      botSessionsTable.grantReadWriteData(fn);
      rolesTable.grantReadWriteData(fn);
      approvalChainsTable.grantReadWriteData(fn);
      settlementBatchesTable.grantReadWriteData(fn);
      expenseMotivesTable.grantReadWriteData(fn);
      locationsTable.grantReadWriteData(fn);
    }

    glpiSecret.grantRead(apiFn);
    glpiSecret.grantRead(botFn);

    botFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:DetectDocumentText'],
        resources: ['*'],
      }),
    );
    botFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );

    const httpApi = new apigatewayv2.HttpApi(this, 'ViaticosHttpApi', {
      apiName: 'viaticos-api',
      description: `Viáticos API + Telegram webhook (${domainName})`,
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type', 'X-Telegram-Bot-Api-Secret-Token'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [`https://${domainName}`, 'http://localhost:5173'],
        maxAge: cdk.Duration.days(1),
      },
    });

    httpApi.addRoutes({
      path: '/telegram/webhook',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('BotIntegration', botFn),
    });

    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('ApiProxyIntegration', apiFn),
    });

    httpApi.addRoutes({
      path: '/api',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('ApiRootIntegration', apiFn),
    });

    // Also accept paths without /api prefix when called via execute-api directly
    httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('HealthIntegration', apiFn),
    });

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'ecorp.com.ar',
    });

    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'WebOAI');
    webBucket.grantRead(oai);

    const apiOriginDomain = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));

    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: new origins.S3Origin(webBucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiOriginDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1),
        },
      ],
    });

    new route53.ARecord(this, 'AliasRecord', {
      zone: hostedZone,
      recordName: 'viaticos',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new route53.AaaaRecord(this, 'AliasRecordAAAA', {
      zone: hostedZone,
      recordName: 'viaticos',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources: [s3deploy.Source.asset(path.join(repoRoot, 'web/dist'))],
      destinationBucket: webBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    const webhookUrl = `${httpApi.apiEndpoint}/telegram/webhook`;

    const setWebhookFn = new NodejsFunction(this, 'SetWebhookFn', {
      entry: path.join(repoRoot, 'infra/lambdas/set-webhook.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        TELEGRAM_SECRET_NAME: SECRETS.telegramBotToken,
        WEBHOOK_URL: webhookUrl,
        WEBHOOK_SECRET_ARN: webhookSecret.secretArn,
      },
      bundling: {
        minify: true,
        target: 'node20',
        format: OutputFormat.ESM,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });
    telegramSecret.grantRead(setWebhookFn);
    webhookSecret.grantRead(setWebhookFn);

    const setWebhookProvider = new cr.Provider(this, 'SetWebhookProvider', {
      onEventHandler: setWebhookFn,
    });

    new cdk.CustomResource(this, 'ConfigureTelegramWebhook', {
      serviceToken: setWebhookProvider.serviceToken,
      properties: {
        WebhookUrl: webhookUrl,
        Version: '4',
        CommandsVersion: '2',
      },
    });

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${domainName}` });
    new cdk.CfnOutput(this, 'HttpApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'TelegramWebhookUrl', { value: webhookUrl });
    new cdk.CfnOutput(this, 'ReceiptsBucketName', { value: receiptsBucket.bucketName });
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
    });
  }
}
