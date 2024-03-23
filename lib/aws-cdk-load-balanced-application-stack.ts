import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Duration } from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export class AwsCdkLoadBalancedApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new VPC
    const defaultVpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2, // Maximum availability zones
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC, // Public subnet
        },
      ],
    });

    const ami = ec2.MachineImage.latestAmazonLinux2();

    const instanceType = ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO);

    const securityGroup = new ec2.SecurityGroup(this, 'securityGroup', {
      vpc: defaultVpc,
    });
    securityGroup.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(80), 'Added by a CDK stack');

    const userData = ec2.UserData.forLinux();
    userData.addCommands('yum update -y', 'yum install -y httpd.x86_64', 'service httpd start', 'echo “Hello World from $(hostname -f)” > /var/www/html/index.html');

    const role = new iam.Role(this, 'roleForSSM', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      machineImage: ami,
      instanceType: instanceType,
      securityGroup: securityGroup,
      userData: userData,
      role: role,
    });

    const autoscalingGroup = new autoscaling.AutoScalingGroup(this, 'autoscalingGroup', {
      vpc: defaultVpc,
      launchTemplate: launchTemplate,
      minCapacity: 2,
      maxCapacity: 2,
      desiredCapacity: 2,
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'applicationLoadBalacner', {
      vpc: defaultVpc,
      internetFacing: true,
    });

    const listener = alb.addListener('listner', {
      port: 443,
      certificates: [
        // Replace with your SSL certificate ARN
        elbv2.ListenerCertificate.fromArn('arn:aws:acm:us-east-1:983245592084:certificate/c726e90f-00bb-4024-92ab-29635b10c031'),
      ],
      defaultAction: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'Hello from the load balancer!',
      }),
    });

    listener.addTargets('ApplicationFleet', {
      port: 80,
      targets: [autoscalingGroup],
      healthCheck: {
        path: '/',
        interval: Duration.minutes(1),
      },
    });

    autoscalingGroup.connections.allowFrom(alb, ec2.Port.tcp(80));

    // Define your hosted zone
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'mungnx.net', // Replace this with your domain name
      privateZone: false, // Update if your hosted zone is private
    });

    // Create a record in Route 53 to point to the load balancer
    new route53.ARecord(this, 'AliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
      recordName: 'mungnx.net', // Replace with your domain name
    });
  }
}
