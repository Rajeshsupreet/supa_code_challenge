import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as iam from '@aws-cdk/aws-iam';


export class MyEcsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2
    });

    

    // Create a RDS PostgreSQL database
    const dbSecret = new secretsmanager.Secret(this, 'MyDbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'techdbadmin' }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });



    const dbInstance = new rds.DatabaseInstance(this, 'MyDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_14 }),
      vpc,
      allowMajorVersionUpgrade: true,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      databaseName: 'techdb',
      credentials: rds.Credentials.fromSecret(dbSecret)
    });

    // Create an ECS Fargate Service
    const cluster = new ecs.Cluster(this, 'MyCluster', {
      vpc
    });

    // Add IAM Role for ECS Task Execution
    const taskRole = new iam.Role(this, 'MigrationTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });


    // Attach Policy to ECS Task Role to allow communication with PostgreSQL DB
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
          "rds-db:connect",
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement",
          "rds:DescribeDBInstances",
          "rds:DescribeDBClusters",
          "rds:ListTagsForResource",
          "rds:TagResource",
          "rds:UntagResource",
          "rds:DescribeDBSnapshots",
          "rds:CreateDBInstanceSnapshot",
          "rds:DeleteDBInstanceSnapshot"
        // Add more permissions as needed for your migrationscdk l
      ],
      resources: ['*'],
    }));

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MyTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole,
    });

    // Add a Container to the Task Definition
    const container = taskDefinition.addContainer('MyContainer', {
      image: ecs.ContainerImage.fromRegistry('servian/techchallengeapp:latest'),
      // Add your custom Docker run commands
      command: ['updatedb','serve'],
      environment: {
        VTT_DBHOST: dbInstance.dbInstanceEndpointAddress,
        VTT_DBPORT: dbInstance.dbInstanceEndpointPort.toString(),
        VTT_DBNAME: 'techdb',
        VTT_DBUSER: 'techdbadmin',
        VTT_DBPASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap().toString(),
        VTT_LISTENHOST: '0.0.0.0',
        VTT_LISTENPORT: '3000',
      },
      logging: ecs.LogDriver.awsLogs({ streamPrefix: 'MyContainer' }),
      portMappings: [{ containerPort: 3000 }]
    });

    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MyFargateService', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      publicLoadBalancer: true,
    });


    // Allow ECS Service to access the PostgreSQL database
    dbInstance.connections.allowDefaultPortFrom(service.service, 'Allow traffic from ECS Service to RDS');

    // Output the URL of the Fargate Service
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: service.loadBalancer.loadBalancerDnsName
    });
  }
}

const app = new cdk.App();
new MyEcsStack(app, 'MyEcsStack');
