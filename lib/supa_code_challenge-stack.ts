import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export class MyEcsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2
    });

    const securityGroup = new ec2.SecurityGroup(this, 'db_SecurityGroup', {
      vpc: vpc,
      description: 'My Security Group',
      allowAllOutbound: true,
    });


  
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'Allow PostgreSQL traffic');



    // Create a RDS PostgreSQL database
    const dbSecret = new secretsmanager.Secret(this, 'MyDbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    const dbInstance = new rds.DatabaseInstance(this, 'MyDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15_5}),
      vpc,
      allowMajorVersionUpgrade: true,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      //databaseName: 'techdb',
      credentials: rds.Credentials.fromSecret(dbSecret),
      publiclyAccessible: true,
      securityGroups: [securityGroup],
      //subnetGroup: rds.SubnetGroup.fromSubnetGroupName(this, 'ExistingDBSubnetGroup', existingDBSubnetGroupName),
      availabilityZone: 'us-east-1a',
      //parameterGroup,
    });

    // Create an ECS Fargate Service
    const cluster = new ecs.Cluster(this, 'MyCluster', {
      vpc
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MyTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Add a Container to the Task Definition
    const container = taskDefinition.addContainer('MyContainer', {
      image: ecs.ContainerImage.fromRegistry('servian/techchallengeapp:0.10.0'),
      // Add  custom Docker run commands
      command: ['updatedb', '-s', '&&', 'serve'],
      environment: {
        VTT_DBHOST: dbInstance.dbInstanceEndpointAddress,
        VTT_DBPORT: dbInstance.dbInstanceEndpointPort.toString(),
        VTT_DBNAME: 'postgres',
        VTT_DBUSER: 'postgres',
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
